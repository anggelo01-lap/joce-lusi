const express = require('express');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const pool = require('./db/pool');
const db = pool.raw;
const scrypt = promisify(crypto.scrypt);
const router = express.Router();
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const fail = (status,message) => Object.assign(new Error(message),{status});
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const publicUser = u => ({id:u.id,nombre:u.nombre,email:u.email,rol:u.rol,empresa_id:u.empresa_id,activo:u.activo});
const cookieOptions = {httpOnly:true,sameSite:'strict',secure:process.env.COOKIE_SECURE==='true',path:'/'};
const goodPassword = p => typeof p==='string' && p.length>=12 && p.length<=128;
function validateAccount(body) {
  if (typeof body.nombre!=='string' || !body.nombre.trim() || body.nombre.trim().length>120 ||
      typeof body.email!=='string' || body.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) || !goodPassword(body.password))
    throw fail(400,'Indica nombre, correo válido y contraseña de 12 a 128 caracteres.');
}
async function hashPassword(password) {
  const salt=crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password,salt,64)).toString('hex')}`;
}
async function verify(password,encoded) {
  const [salt,hash]=encoded.split(':');
  const actual=await scrypt(password,salt,64);
  return crypto.timingSafeEqual(actual,Buffer.from(hash,'hex'));
}
async function session(req,res,user) {
  const token=crypto.randomBytes(32).toString('hex'), csrf=crypto.randomBytes(32).toString('hex');
  const company=user.empresa_id || (await db.query("SELECT id FROM public.empresas WHERE esquema='public'")).rows[0].id;
  await db.query('DELETE FROM public.sesiones WHERE vence_en<NOW()');
  await db.query("INSERT INTO public.sesiones VALUES($1,$2,$3,$4,NOW()+INTERVAL '12 hours')",[sha(token),user.id,company,csrf]);
  res.cookie('platinum_session',token,{...cookieOptions,maxAge:12*60*60*1000});
  res.json({usuario:publicUser(user),empresa_id:company,csrf});
}
const authenticate = wrap(async (req,res,next) => {
  const cookie=(req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('platinum_session='));
  const token=cookie?.slice('platinum_session='.length);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw fail(401,'Inicia sesión para continuar.');
  const result=await db.query(`SELECT c.*,s.empresa_id AS empresa_activa,s.csrf,s.token_hash,e.esquema,e.nombre AS empresa_nombre
    FROM public.sesiones s JOIN public.cuentas c ON c.id=s.cuenta_id JOIN public.empresas e ON e.id=s.empresa_id
    WHERE s.token_hash=$1 AND s.vence_en>NOW() AND c.activo`,[sha(token)]);
  const u=result.rows[0];
  if (!u || (u.rol!=='superadmin' && u.empresa_id!==u.empresa_activa)) throw fail(401,'La sesión ha caducado.');
  req.access=u;
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers['x-csrf-token']!==u.csrf) throw fail(403,'La sesión no autoriza esta solicitud. Recarga la página.');
  pool.context.run({schema:u.esquema,companyId:u.empresa_activa},next);
});
function roles(...allowed) { return (req,res,next) => allowed.includes(req.access.rol)?next():next(fail(403,'Tu rol no permite esta operación.')); }
// A same-origin JSON request is required even before a session exists.
router.use((req,res,next)=>{
  if (!['GET','HEAD'].includes(req.method)) {
    if (!req.is('application/json')) return next(fail(415,'Usa JSON para esta operación.'));
    const origin=req.headers.origin;
    if (origin) { let host;try{host=new URL(origin).host;}catch{ return next(fail(403,'Origen inválido.')); }
      if(host!==req.headers.host)return next(fail(403,'Origen no autorizado.'));
    }
    if(req.headers['sec-fetch-site']==='cross-site')return next(fail(403,'Origen no autorizado.'));
  }
  next();
});
router.get('/estado',wrap(async (_req,res)=>res.json({requiere_configuracion:!(await db.query('SELECT 1 FROM public.cuentas LIMIT 1')).rowCount})));
router.post('/configurar',wrap(async (req,res)=>{
  const expected=process.env.ADMIN_SETUP_TOKEN;
  if(!expected || expected.length<32 || expected==='CAMBIAR_CODIGO_INSTALACION_ALEATORIO')throw fail(503,'Configura ADMIN_SETUP_TOKEN con un código aleatorio de al menos 32 caracteres en .env.');
  if(!expected || typeof req.body.codigo!=='string' || sha(req.body.codigo)!==sha(expected))throw fail(403,'Código de instalación incorrecto. Consulta ADMIN_SETUP_TOKEN en .env.');
  const users=req.body.programadores;
  if(!Array.isArray(users) || users.length!==2)throw fail(400,'Registra las dos cuentas de los programadores.');
  users.forEach(validateAccount);
  if(users[0].email.trim().toLowerCase()===users[1].email.trim().toLowerCase())throw fail(400,'Usa correos diferentes.');
  const hashes=await Promise.all(users.map(u=>hashPassword(u.password)));
  const client=await db.connect();let first;
  try {
    await client.query('BEGIN');await client.query('LOCK TABLE public.cuentas IN EXCLUSIVE MODE');
    if((await client.query('SELECT 1 FROM public.cuentas LIMIT 1')).rowCount)throw fail(409,'La instalación ya está configurada.');
    for(let i=0;i<2;i++) {
      const result=await client.query("INSERT INTO public.cuentas(nombre,email,password_hash,rol) VALUES($1,$2,$3,'superadmin') RETURNING *",[users[i].nombre.trim(),users[i].email.trim().toLowerCase(),hashes[i]]);
      if(!i)first=result.rows[0];
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  await session(req,res,first);
}));
router.post('/login',wrap(async (req,res)=>{
  const {email,password}=req.body;
  if(typeof email!=='string' || email.length>254 || typeof password!=='string' || password.length>128)throw fail(400,'Correo o contraseña inválidos.');
  const key=sha(`${req.ip}|${email.trim().toLowerCase()}`);
  const attempt=(await db.query(`INSERT INTO public.intentos_acceso(clave,intentos) VALUES($1,1)
    ON CONFLICT(clave) DO UPDATE SET intentos=CASE WHEN intentos_acceso.desde<NOW()-INTERVAL '15 minutes' THEN 1 ELSE intentos_acceso.intentos+1 END,
    desde=CASE WHEN intentos_acceso.desde<NOW()-INTERVAL '15 minutes' THEN NOW() ELSE intentos_acceso.desde END RETURNING intentos`,[key])).rows[0];
  if(attempt.intentos>10)throw fail(429,'Demasiados intentos. Espera 15 minutos.');
  const user=(await db.query('SELECT * FROM public.cuentas WHERE email=$1',[email.trim().toLowerCase()])).rows[0];
  const dummy='00000000000000000000000000000000:'+ '00'.repeat(64);
  const matches=await verify(password,user?.password_hash || dummy);
  if(!matches || !user?.activo)throw fail(401,'Correo o contraseña incorrectos.');
  await db.query('DELETE FROM public.intentos_acceso WHERE clave=$1',[key]);
  await session(req,res,user);
}));
router.use(authenticate);
router.get('/yo',(req,res)=>res.json({usuario:publicUser(req.access),empresa:{id:req.access.empresa_activa,nombre:req.access.empresa_nombre},csrf:req.access.csrf}));
router.post('/logout',wrap(async(req,res)=>{await db.query('DELETE FROM public.sesiones WHERE token_hash=$1',[req.access.token_hash]);res.clearCookie('platinum_session',cookieOptions);res.json({ok:true});}));
router.put('/password',wrap(async(req,res)=>{
  if(!goodPassword(req.body.password) || typeof req.body.actual!=='string' || req.body.actual.length>128)throw fail(400,'La nueva contraseña debe tener de 12 a 128 caracteres.');
  if(!await verify(req.body.actual,req.access.password_hash))throw fail(403,'Contraseña actual incorrecta.');
  await db.query('UPDATE public.cuentas SET password_hash=$1 WHERE id=$2',[await hashPassword(req.body.password),req.access.id]);
  await db.query('DELETE FROM public.sesiones WHERE cuenta_id=$1 AND token_hash<>$2',[req.access.id,req.access.token_hash]);res.json({ok:true});
}));
router.get('/empresas',wrap(async(req,res)=>res.json((await db.query('SELECT id,nombre,creado_en FROM public.empresas WHERE $1::boolean OR id=$2 ORDER BY id',[req.access.rol==='superadmin',req.access.empresa_activa])).rows)));
router.post('/empresa-activa',roles('superadmin'),wrap(async(req,res)=>{
  const id=Number(req.body.empresa_id);
  if(!Number.isSafeInteger(id) || id<1 || !(await db.query('SELECT 1 FROM public.empresas WHERE id=$1',[id])).rowCount)throw fail(400,'Empresa inválida.');
  await db.query('UPDATE public.sesiones SET empresa_id=$1 WHERE token_hash=$2',[id,req.access.token_hash]);res.json({ok:true});
}));
router.post('/empresas',roles('superadmin'),wrap(async(req,res)=>{
  const name=req.body.nombre;
  if(typeof name!=='string' || !name.trim() || name.trim().length>120)throw fail(400,'Indica un nombre de empresa válido.');
  const client=await db.connect();let company;
  try{
    await client.query('BEGIN');
    const id=(await client.query("SELECT nextval('public.empresas_id_seq') AS id")).rows[0].id;
    const schema=`empresa_${id}`;
    await client.query(`CREATE SCHEMA "${schema}"`);await client.query(`SET LOCAL search_path TO "${schema}"`);
    await client.query(fs.readFileSync(path.join(__dirname,'../../database/init.sql'),'utf8'));
    await client.query(fs.readFileSync(path.join(__dirname,'db/operaciones.sql'),'utf8'));
    await client.query('UPDATE configuracion_operativa SET datos=datos || $1::jsonb WHERE id=1',[JSON.stringify({empresa:name.trim()})]);
    company=(await client.query('INSERT INTO public.empresas(id,nombre,esquema) VALUES($1,$2,$3) RETURNING id,nombre',[id,name.trim(),schema])).rows[0];
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  res.status(201).json(company);
}));
router.patch('/empresas/:id',roles('superadmin'),wrap(async(req,res)=>{
  const id=Number(req.params.id), nombre=req.body.nombre;
  if(!Number.isSafeInteger(id) || id<1 || typeof nombre!=='string' || !nombre.trim() || nombre.trim().length>120)throw fail(400,'Empresa o nombre inválidos.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    const company=(await client.query('SELECT * FROM public.empresas WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!company)throw fail(404,'Empresa no encontrada.');
    if(!/^(public|empresa_[0-9]+)$/.test(company.esquema))throw fail(409,'Esquema de empresa inválido.');
    await client.query('UPDATE public.empresas SET nombre=$1 WHERE id=$2',[nombre.trim(),id]);
    await client.query(`UPDATE "${company.esquema}".configuracion_operativa SET datos=datos || $1::jsonb,actualizado_en=NOW() WHERE id=1`,[JSON.stringify({empresa:nombre.trim()})]);
    await client.query('COMMIT');res.json({id,nombre:nombre.trim()});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}));
router.delete('/empresas/:id',roles('superadmin'),wrap(async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id) || id<1)throw fail(400,'Empresa inválida.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');
    await client.query('LOCK TABLE public.empresas,public.cuentas,public.sesiones IN EXCLUSIVE MODE');
    const company=(await client.query('SELECT * FROM public.empresas WHERE id=$1',[id])).rows[0];
    if(!company)throw fail(404,'Empresa no encontrada.');
    if(company.esquema==='public' || id===req.access.empresa_activa)throw fail(409,'No puedes eliminar la empresa original ni la empresa activa. Abre otra empresa primero.');
    if(!/^empresa_[0-9]+$/.test(company.esquema))throw fail(409,'Esquema de empresa inválido.');
    if((await client.query('SELECT 1 FROM public.cuentas WHERE empresa_id=$1',[id])).rowCount)throw fail(409,'Elimina las cuentas de esta empresa antes de eliminarla.');
    const tables=['clientes','conductores','personas_conductoras','llamadas','servicios','conversaciones','notificaciones_zello','posiciones_unidad'];
    await client.query(`LOCK TABLE ${tables.map(t=>`"${company.esquema}".${t}`).join(',')} IN EXCLUSIVE MODE`);
    for(const table of tables)if((await client.query(`SELECT 1 FROM "${company.esquema}".${table} LIMIT 1`)).rowCount)throw fail(409,'La empresa tiene datos operativos. No se puede eliminar.');
    await client.query('DELETE FROM public.sesiones WHERE empresa_id=$1',[id]);
    await client.query('DELETE FROM public.empresas WHERE id=$1',[id]);
    await client.query(`DROP SCHEMA "${company.esquema}" CASCADE`);
    await client.query('COMMIT');res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}));
router.get('/usuarios',roles('superadmin','admin'),wrap(async(req,res)=>{
  const users=await db.query(`SELECT id,nombre,email,rol,empresa_id,activo FROM public.cuentas
    WHERE (empresa_id=$1 OR ($2::boolean AND rol='superadmin')) ORDER BY rol,nombre`,[req.access.empresa_activa,req.access.rol==='superadmin']);res.json(users.rows);
}));
router.post('/usuarios',roles('superadmin','admin'),wrap(async(req,res)=>{
  validateAccount(req.body);
  const allowed=req.access.rol==='superadmin'?['superadmin','admin','usuario']:['usuario'];
  if(!allowed.includes(req.body.rol))throw fail(403,'No puedes crear ese rol.');
  const encoded=await hashPassword(req.body.password);
  const client=await db.connect();let user;
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE public.cuentas IN EXCLUSIVE MODE');
    if(req.body.rol==='superadmin') {
      const count=(await client.query("SELECT COUNT(*)::int AS total FROM public.cuentas WHERE rol='superadmin'")).rows[0].total;
      if(count>=2)throw fail(409,'Ya están registradas las dos cuentas de los programadores.');
    }
    user=(await client.query('INSERT INTO public.cuentas(nombre,email,password_hash,rol,empresa_id) VALUES($1,$2,$3,$4,$5) RETURNING id,nombre,email,rol,empresa_id,activo',
      [req.body.nombre.trim(),req.body.email.trim().toLowerCase(),encoded,req.body.rol,req.body.rol==='superadmin'?null:req.access.empresa_activa])).rows[0];
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  res.status(201).json(user);
}));
router.patch('/usuarios/:id',roles('superadmin','admin'),wrap(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id) || id<1)throw fail(400,'Cuenta inválida.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');await client.query('LOCK TABLE public.cuentas IN EXCLUSIVE MODE');
    const target=(await client.query('SELECT * FROM public.cuentas WHERE id=$1',[id])).rows[0];
    if(!target || (target.empresa_id!==req.access.empresa_activa && target.rol!=='superadmin'))throw fail(404,'Cuenta no encontrada.');
    if(req.access.rol==='admin' && target.rol!=='usuario')throw fail(403,'Solo puedes administrar trabajadores de tu empresa.');
    if(target.rol==='superadmin')throw fail(403,'Las cuentas de los programadores conservan su rol y acceso. Cada uno puede cambiar su propia contraseña.');
    const allowed=req.access.rol==='superadmin'?['admin','usuario']:['usuario'];
    const role=req.body.rol ?? target.rol, active=req.body.activo ?? target.activo;
    if(!allowed.includes(role) || typeof active!=='boolean')throw fail(400,'Rol o estado inválidos.');
    if(id===req.access.id && (role!==target.rol || !active))throw fail(409,'No puedes retirar tu propio acceso.');
    if(target.rol==='admin' && target.activo && (role!=='admin' || !active)) {
      const others=await client.query("SELECT 1 FROM public.cuentas WHERE empresa_id=$1 AND rol='admin' AND activo AND id<>$2",[target.empresa_id,id]);
      if(!others.rowCount)throw fail(409,'La empresa debe conservar al menos un administrador activo.');
    }
    let encoded=target.password_hash;
    if(req.body.password!==undefined){if(!goodPassword(req.body.password))throw fail(400,'La contraseña debe tener de 12 a 128 caracteres.');encoded=await hashPassword(req.body.password);}
    const nombre=req.body.nombre ?? target.nombre, email=req.body.email ?? target.email;
    validateAccount({nombre,email,password:'validation-only-password'});
    await client.query('UPDATE public.cuentas SET rol=$1,activo=$2,password_hash=$3,nombre=$5,email=$6 WHERE id=$4',[role,active,encoded,id,nombre.trim(),email.trim().toLowerCase()]);
    await client.query('DELETE FROM public.sesiones WHERE cuenta_id=$1',[id]);
    await client.query('COMMIT');res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}));
router.delete('/usuarios/:id',roles('superadmin'),wrap(async(req,res)=>{
  const id=Number(req.params.id);
  if(!Number.isSafeInteger(id) || id<1)throw fail(400,'Cuenta inválida.');
  const client=await db.connect();
  try{
    await client.query('BEGIN');await client.query('LOCK TABLE public.cuentas IN EXCLUSIVE MODE');
    const target=(await client.query('SELECT * FROM public.cuentas WHERE id=$1',[id])).rows[0];
    if(!target || target.empresa_id!==req.access.empresa_activa)throw fail(404,'Cuenta no encontrada en la empresa activa.');
    if(id===req.access.id || target.rol==='superadmin')throw fail(403,'No puedes eliminar tu cuenta ni una cuenta de superadministrador.');
    if(target.rol==='admin' && target.activo && !(await client.query("SELECT 1 FROM public.cuentas WHERE empresa_id=$1 AND rol='admin' AND activo AND id<>$2",[target.empresa_id,id])).rowCount)throw fail(409,'La empresa debe conservar al menos un administrador activo.');
    await client.query('DELETE FROM public.cuentas WHERE id=$1',[id]);
    await client.query('COMMIT');res.json({ok:true});
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}));
module.exports={router,authenticate,roles};
