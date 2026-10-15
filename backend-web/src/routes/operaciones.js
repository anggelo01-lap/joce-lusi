const express = require('express');
const axios = require('axios');
const pool = require('../db/pool');
const { responder } = require('../services/orion.service');
const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const id = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const text = (value, max = 120) => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
const estados = ['SOLICITADO', 'ASIGNADO', 'EN_RECOJO', 'EN_CURSO', 'COMPLETADO', 'CANCELADO'];

router.get('/configuracion', wrap(async (_req, res) => {
  const { rows } = await pool.query('SELECT datos, actualizado_en FROM configuracion_operativa WHERE id=1');
  res.json({ ...rows[0].datos, actualizado_en: rows[0].actualizado_en });
}));
router.put('/configuracion', wrap(async (req, res) => {
  if (req.access && !['superadmin','admin'].includes(req.access.rol)) throw fail(403, 'Solo el administrador puede cambiar la configuración de la empresa.');
  const { empresa, intervalo_segundos } = req.body;
  if (!text(empresa) || !Number.isInteger(intervalo_segundos) || intervalo_segundos < 15 || intervalo_segundos > 300)
    throw fail(400, 'Empresa e intervalo (15–300 segundos) inválidos.');
  const { rows } = await pool.query(`UPDATE configuracion_operativa SET datos=datos || $1::jsonb, actualizado_en=NOW() WHERE id=1 RETURNING datos`, [JSON.stringify({ empresa: empresa.trim(), intervalo_segundos })]);
  if(req.access) await pool.raw.query('UPDATE public.empresas SET nombre=$1 WHERE id=$2',[empresa.trim(),req.access.empresa_activa]);
  res.json(rows[0].datos);
}));
router.get('/resumen', wrap(async (_req, res) => {
  const [services, drivers, calls, hours] = await Promise.all([
    pool.query(`SELECT COUNT(*) FILTER (WHERE estado NOT IN ('COMPLETADO','CANCELADO'))::int AS activos,
      COUNT(*) FILTER (WHERE (creado_en AT TIME ZONE 'America/Lima')::date=(NOW() AT TIME ZONE 'America/Lima')::date)::int AS hoy,
      COUNT(*) FILTER (WHERE estado='SOLICITADO')::int AS pendientes,
      COALESCE(SUM(tarifa) FILTER (WHERE estado='COMPLETADO' AND (finalizado_en AT TIME ZONE 'America/Lima')::date=(NOW() AT TIME ZONE 'America/Lima')::date),0) AS facturado_hoy,
      COUNT(*) FILTER (WHERE estado='COMPLETADO' AND tarifa IS NULL)::int AS sin_tarifa,
      COUNT(*) FILTER (WHERE estado='SOLICITADO' AND creado_en < NOW()-INTERVAL '5 minutes')::int AS esperando_mucho,
      COUNT(*) FILTER (WHERE estado='CANCELADO' AND (actualizado_en AT TIME ZONE 'America/Lima')::date=(NOW() AT TIME ZONE 'America/Lima')::date)::int AS cancelados_hoy,
      COUNT(*) FILTER (WHERE estado='COMPLETADO' AND (finalizado_en AT TIME ZONE 'America/Lima')::date=(NOW() AT TIME ZONE 'America/Lima')::date)::int AS completados_hoy FROM servicios`),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE estado='DISPONIBLE')::int AS disponibles,
      COUNT(*) FILTER (WHERE ubicacion_en >= NOW()-INTERVAL '5 minutes')::int AS gps_reciente FROM conductores`),
    pool.query(`SELECT COUNT(*)::int AS hoy FROM llamadas WHERE (inicio AT TIME ZONE 'America/Lima')::date=(NOW() AT TIME ZONE 'America/Lima')::date`),
    pool.query(`SELECT EXTRACT(HOUR FROM creado_en AT TIME ZONE 'America/Lima')::int AS hora, COUNT(*)::int AS cantidad FROM servicios WHERE (creado_en AT TIME ZONE 'America/Lima')::date=(NOW() AT TIME ZONE 'America/Lima')::date GROUP BY 1 ORDER BY 1`)
  ]);
  res.json({ servicios: services.rows[0], unidades: drivers.rows[0], llamadas: calls.rows[0], horas: hours.rows, actualizado_en: new Date().toISOString() });
}));
router.get('/estadisticas', wrap(async (_req, res) => {
  const lima = "(NOW() AT TIME ZONE 'America/Lima')::date";
  const [semana, categorias, estados, tiempos, unidades] = await Promise.all([
    pool.query(`SELECT d::date AS dia, COALESCE(COUNT(s.id),0)::int AS servicios,
        COALESCE(SUM(s.tarifa) FILTER (WHERE s.estado='COMPLETADO'),0) AS facturado
      FROM generate_series(${lima}-6, ${lima}, '1 day') d
      LEFT JOIN servicios s ON (s.creado_en AT TIME ZONE 'America/Lima')::date = d::date GROUP BY 1 ORDER BY 1`),
    pool.query(`SELECT COALESCE(categoria,'sin categoría') AS categoria, COUNT(*)::int AS cantidad FROM servicios
      WHERE creado_en >= NOW()-INTERVAL '30 days' GROUP BY 1 ORDER BY 2 DESC`),
    pool.query(`SELECT estado, COUNT(*)::int AS cantidad FROM servicios GROUP BY 1`),
    pool.query(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM (finalizado_en-creado_en))/60))::int AS minutos_promedio,
        COUNT(*) FILTER (WHERE estado='COMPLETADO')::int AS completados,
        COUNT(*) FILTER (WHERE estado='CANCELADO')::int AS cancelados,
        COALESCE(ROUND(AVG(tarifa) FILTER (WHERE estado='COMPLETADO' AND tarifa IS NOT NULL),2),0) AS tarifa_promedio
      FROM servicios WHERE creado_en >= NOW()-INTERVAL '30 days'`),
    pool.query(`SELECT c.id, c.codigo, c.codigo AS nombre, c.placa, COUNT(s.id)::int AS servicios,
        COALESCE(SUM(s.tarifa),0) AS facturado
      FROM conductores c LEFT JOIN servicios s ON s.conductor_id=c.id AND s.estado='COMPLETADO'
        AND s.finalizado_en >= NOW()-INTERVAL '30 days' GROUP BY c.id ORDER BY servicios DESC, c.id LIMIT 5`)
  ]);
  res.json({ semana: semana.rows, categorias: categorias.rows, estados: estados.rows, rendimiento: tiempos.rows[0], unidades: unidades.rows });
}));
router.get('/llamadas/:id/conversacion', wrap(async (req, res) => {
  if (!id(req.params.id)) throw fail(400, 'Llamada inválida.');
  const { rows } = await pool.query('SELECT rol, contenido, creado_en FROM conversaciones WHERE llamada_id=$1 ORDER BY id', [req.params.id]);
  res.json(rows);
}));
function driverData(body) {
  const { codigo, placa, vehiculo, categoria } = body;
  if (!text(codigo,30) || !text(placa,20) || !text(vehiculo) || !['sedan','suv','van'].includes(categoria)) throw fail(400,'Revisa los datos de la unidad.');
  return [codigo.trim(),'','',placa.trim().toUpperCase(),vehiculo.trim(),categoria];
}
router.use(require('./flota'));
router.post(['/conductores','/unidades'], wrap(async (req, res) => {
  const { rows } = await pool.query(`INSERT INTO conductores(codigo,nombre,telefono,placa,vehiculo,categoria) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, driverData(req.body));
  res.status(201).json(rows[0]);
}));
router.get(['/conductores/:id','/unidades/:id'], wrap(async (req,res) => {
  if(!id(req.params.id)) throw fail(400,'Unidad inválida.');
  const {rows}=await pool.query("SELECT u.*,p.nombre,p.telefono FROM conductores u LEFT JOIN personas_conductoras p ON p.id=u.chofer_id WHERE u.id=$1",[req.params.id]);
  if(!rows.length) throw fail(404,'Unidad no encontrada.');
  res.json(rows[0]);
}));
async function changeDriver(req,res,remove) {
  if(!id(req.params.id)) throw fail(400,'Unidad inválida.');
  const values=remove?null:driverData(req.body),db=await pool.connect();
  try {
    await db.query('BEGIN');
    // Match dispatch lock order so edits/deletions cannot race assignments.
    await db.query('LOCK TABLE servicios IN SHARE ROW EXCLUSIVE MODE');
    const driver=(await db.query('SELECT * FROM conductores WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if(!driver) throw fail(404,'Unidad no encontrada.');
    const services=await db.query("SELECT id FROM servicios WHERE conductor_id=$1 AND estado NOT IN ('COMPLETADO','CANCELADO')",[driver.id]);
    if(services.rowCount) throw fail(409,'La unidad tiene un servicio activo. Finalízalo o cancélalo antes de editar o eliminar.');
    let result;
    if(remove) {
      const history=await db.query('SELECT 1 FROM servicios WHERE conductor_id=$1 UNION ALL SELECT 1 FROM posiciones_unidad WHERE conductor_id=$1 LIMIT 1',[driver.id]);
      if(history.rowCount) throw fail(409,'No se puede eliminar una unidad con servicios o ubicaciones registrados. Su historial debe conservarse.');
      await db.query('DELETE FROM conductores WHERE id=$1',[driver.id]);
      result={eliminado:true,id:driver.id};
    }else{
      result=(await db.query('UPDATE conductores SET codigo=$1,placa=$2,vehiculo=$3,categoria=$4 WHERE id=$5 RETURNING *',[values[0],values[3],values[4],values[5],driver.id])).rows[0];
    }
    await db.query('COMMIT');res.json(result);
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
router.put(['/conductores/:id','/unidades/:id'],wrap((req,res)=>changeDriver(req,res,false)));
router.delete(['/conductores/:id','/unidades/:id'],wrap((req,res)=>changeDriver(req,res,true)));
router.patch('/servicios/:id', wrap(async (req, res) => {
  if (!id(req.params.id)) throw fail(400,'Servicio inválido.');
  const { estado, conductor_id, tarifa } = req.body;
  if (!estados.includes(estado) || (conductor_id != null && !id(conductor_id)) || (tarifa != null && (typeof tarifa !== 'number' || !Number.isFinite(tarifa) || tarifa < 0 || tarifa > 99999999))) throw fail(400,'Estado, conductor o tarifa inválidos.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serialize assignments and terminal transitions to prevent double dispatch.
    await db.query('LOCK TABLE servicios IN SHARE ROW EXCLUSIVE MODE');
    const service = (await db.query('SELECT * FROM servicios WHERE id=$1 FOR UPDATE',[req.params.id])).rows[0];
    if (!service) throw fail(404,'Servicio no encontrado.');
    const transitions = { SOLICITADO:['ASIGNADO','CANCELADO'], ASIGNADO:['EN_RECOJO','CANCELADO'], EN_RECOJO:['EN_CURSO','CANCELADO'], EN_CURSO:['COMPLETADO','CANCELADO'], COMPLETADO:[], CANCELADO:[] };
    if (estado!==service.estado && !(transitions[service.estado] || []).includes(estado)) throw fail(409,'El cambio de estado no corresponde al flujo del servicio.');
    const driverId = conductor_id == null ? service.conductor_id : conductor_id;
    if (estado==='SOLICITADO' && driverId) throw fail(400,'Selecciona ASIGNADO para asignar una unidad.');
    if (['COMPLETADO','CANCELADO'].includes(service.estado) && driverId != service.conductor_id) throw fail(409,'No se puede reasignar un servicio finalizado.');
    if (!['SOLICITADO','CANCELADO'].includes(estado) && !driverId) throw fail(400,'Asigna una unidad antes de continuar.');
    let assignedPerson=null;
    if (driverId) {
      const driver = (await db.query('SELECT * FROM conductores WHERE id=$1 FOR UPDATE',[driverId])).rows[0];
      if (!driver) throw fail(404,'Unidad no encontrada.');
      if (!['COMPLETADO','CANCELADO'].includes(estado)) {
        assignedPerson=(await db.query('SELECT * FROM personas_conductoras WHERE id=$1 AND activo=true',[driver.chofer_id])).rows[0];
        if(!assignedPerson) throw fail(409,'Asigna un conductor activo a la unidad antes de despachar.');
        if (driver.categoria!==service.categoria) throw fail(409,'La categoría de la unidad no coincide con el servicio.');
        const busy = await db.query(`SELECT id FROM servicios WHERE conductor_id=$1 AND id<>$2 AND estado NOT IN ('COMPLETADO','CANCELADO')`,[driverId,service.id]);
        if (busy.rowCount || (driverId != service.conductor_id && driver.estado!=='DISPONIBLE')) throw fail(409,'La unidad no está disponible.');
      }
    }
    const changed=driverId != service.conductor_id;
    const result = await db.query(`UPDATE servicios SET estado=$1::varchar(40), conductor_id=$2, tarifa=COALESCE($3,tarifa), actualizado_en=NOW(), finalizado_en=CASE WHEN $1::varchar(40)='COMPLETADO' THEN COALESCE(finalizado_en,NOW()) ELSE finalizado_en END, chofer_id=$5,conductor_nombre=$6 WHERE id=$4 RETURNING *`,[estado,driverId,tarifa,service.id,changed?assignedPerson?.id || null:service.chofer_id,changed?assignedPerson?.nombre || null:service.conductor_nombre]);
    for (const driver of new Set([service.conductor_id,driverId].filter(Boolean))) {
      await db.query(`UPDATE conductores SET estado=CASE WHEN EXISTS(SELECT 1 FROM servicios WHERE conductor_id=$1 AND estado NOT IN ('COMPLETADO','CANCELADO')) THEN 'OCUPADO' ELSE 'DISPONIBLE' END WHERE id=$1`,[driver]);
    }
    await db.query('COMMIT'); res.json(result.rows[0]);
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}));
router.post(['/conductores/:id/posiciones','/unidades/:id/posiciones'], wrap(async (req, res) => {
  const { latitud, longitud, registrado_en, servicio_id = null, fuente = 'manual' } = req.body;
  if (!id(req.params.id) || typeof latitud !== 'number' || !Number.isFinite(latitud) || Math.abs(latitud)>90 || typeof longitud !== 'number' || !Number.isFinite(longitud) || Math.abs(longitud)>180 || !['manual','gps','movil'].includes(fuente) || (servicio_id!=null && !id(servicio_id))) throw fail(400,'Coordenadas, fuente o identificador inválidos.');
  const date = registrado_en == null ? new Date() : new Date(registrado_en);
  if ((registrado_en != null && (typeof registrado_en !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(registrado_en))) || !Number.isFinite(date.getTime()) || date.getTime()>Date.now()+60000) throw fail(400,'Fecha inválida: usa ISO 8601 con zona horaria y sin fechas futuras.');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const driver = await db.query('SELECT id FROM conductores WHERE id=$1 FOR UPDATE',[req.params.id]);
    if (!driver.rowCount) throw fail(404,'Unidad no encontrada.');
    if (servicio_id!=null) {
      const service = await db.query('SELECT id FROM servicios WHERE id=$1 AND conductor_id=$2',[servicio_id,req.params.id]);
      if (!service.rowCount) throw fail(400,'El servicio no pertenece a esta unidad.');
    }
    const { rows } = await db.query(`INSERT INTO posiciones_unidad(conductor_id,servicio_id,latitud,longitud,registrado_en,fuente) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[req.params.id,servicio_id,latitud,longitud,date,fuente]);
    await db.query(`UPDATE conductores SET latitud=$1,longitud=$2,ubicacion_en=$3 WHERE id=$4 AND (ubicacion_en IS NULL OR ubicacion_en <= $3)`,[latitud,longitud,date,req.params.id]);
    await db.query('COMMIT'); res.status(201).json(rows[0]);
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}));
router.get(['/conductores/:id/recorrido','/unidades/:id/recorrido'], wrap(async (req, res) => {
  const { fecha, servicio_id } = req.query;
  if (!id(req.params.id) || typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(Date.parse(fecha)) || new Date(fecha).toISOString().slice(0,10)!==fecha || (servicio_id != null && !id(servicio_id))) throw fail(400,'Indica una fecha válida AAAA-MM-DD y una unidad.');
  const driver = await pool.query('SELECT id FROM conductores WHERE id=$1',[req.params.id]);
  if (!driver.rowCount) throw fail(404,'Unidad no encontrada.');
  const { rows } = await pool.query(`SELECT * FROM posiciones_unidad WHERE conductor_id=$1 AND registrado_en >= ($2::date::timestamp AT TIME ZONE 'America/Lima') AND registrado_en < (($2::date+1)::timestamp AT TIME ZONE 'America/Lima') AND ($3::int IS NULL OR servicio_id=$3) ORDER BY registrado_en,id LIMIT 20001`,[req.params.id,fecha,servicio_id || null]);
  res.json({ puntos:rows.slice(0,20000), truncado:rows.length>20000, fecha, zona_horaria:'America/Lima' });
}));
router.get('/llamadas', wrap(async (_req, res) => {
  const { rows } = await pool.query(`SELECT l.*, c.nombre AS cliente FROM llamadas l LEFT JOIN clientes c ON c.id=l.cliente_id ORDER BY l.id DESC LIMIT 100`); res.json(rows);
}));
router.post('/orion/chat', wrap(async (req, res) => {
  if (!text(req.body.texto,2000)) throw fail(400,'Escribe un mensaje de hasta 2000 caracteres.');
  try { const datos = req.body.datos && typeof req.body.datos === 'object' && !Array.isArray(req.body.datos) ? req.body.datos : {};
    res.json(await responder(req.body.texto,{ ciudad:'Trujillo',pais:'Perú',canal:'dashboard',datos })); }
  catch (_) { throw fail(503,'Orión no responde. Revisa el microservicio.'); }
}));
router.post('/orion/voz', wrap(async (req, res) => {
  if (!text(req.body.texto, 1000)) throw fail(400, 'Texto inválido para la voz.');
  try {
    const r = await axios.post(`${process.env.ORION_URL || 'http://orion:8000'}/api/speak`, { texto: req.body.texto }, { responseType: 'arraybuffer', timeout: 30000 });
    res.type('audio/mpeg').send(Buffer.from(r.data));
  } catch (error) {
    const status = error.response && error.response.status === 503 ? 503 : 502;
    throw fail(status, status === 503 ? 'La voz no está configurada (ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID).' : 'No se pudo generar la voz.');
  }
}));
router.get('/conexiones', wrap(async (_req, res) => {
  let database = false, orion = false;
  await Promise.all([
    pool.query('SELECT 1').then(()=>{database=true;}).catch(()=>{}),
    axios.get(`${process.env.ORION_URL || 'http://orion:8000'}/health`,{timeout:3000}).then(r=>{orion=r.data.ok===true;}).catch(()=>{})
  ]);
  res.json([
    { nombre:'PostgreSQL', estado:database?'operativo':'sin conexión', detalle:'Conexión comprobada a la base de datos' },
    { nombre:'Orión', estado:orion?'operativo':'sin conexión', detalle:'Asistente de reglas; no asigna unidades automáticamente' },
    { nombre:'Twilio Voice', estado:process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN?'configurado':'pendiente', detalle:'Credenciales locales; disponibilidad externa no verificada' },
    { nombre:'ElevenLabs', estado:process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID?'configurado':'pendiente', detalle:'Credenciales locales; disponibilidad externa no verificada' },
    { nombre:'Zello', estado:process.env.ZELLO_API_URL && process.env.ZELLO_API_TOKEN?'configurado':'pendiente', detalle:'Adaptador genérico; requiere validar el proveedor' },
    { nombre:'Ubicación de unidades', estado:'manual / API', detalle:'Registro de puntos disponible; proveedor GPS pendiente' }
  ]);
}));
module.exports = router;
