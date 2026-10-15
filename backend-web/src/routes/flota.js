const router=require('express').Router();
const pool=require('../db/pool');
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const validId=v=>Number.isSafeInteger(Number(v)) && Number(v)>0;
function personData(body){
  const {codigo,nombre,telefono='',licencia='',activo=true}=body;
  for(const [value,max,required] of [[codigo,30,true],[nombre,120,true],[telefono,30,false],[licencia,40,false]]){
    if(typeof value!=='string' || value.trim().length>max || (required && !value.trim()))throw fail(400,'Revisa código, nombre, teléfono y licencia del conductor.');
  }
  if(typeof activo!=='boolean')throw fail(400,'Estado de conductor inválido.');
  return [codigo.trim(),nombre.trim(),telefono.trim(),licencia.trim(),activo];
}
router.get('/personal-conductores',wrap(async(_req,res)=>{
  const {rows}=await pool.query('SELECT p.*,u.id AS unidad_id,u.codigo AS unidad_codigo,u.placa FROM personas_conductoras p LEFT JOIN conductores u ON u.chofer_id=p.id ORDER BY p.nombre,p.id');res.json(rows);
}));
router.get('/personal-conductores/:id',wrap(async(req,res)=>{
  if(!validId(req.params.id))throw fail(400,'Conductor inválido.');
  const {rows}=await pool.query('SELECT * FROM personas_conductoras WHERE id=$1',[req.params.id]);
  if(!rows.length)throw fail(404,'Conductor no encontrado.');res.json(rows[0]);
}));
router.post('/personal-conductores',wrap(async(req,res)=>{
  const {rows}=await pool.query('INSERT INTO personas_conductoras(codigo,nombre,telefono,licencia,activo) VALUES($1,$2,$3,$4,$5) RETURNING *',personData(req.body));res.status(201).json(rows[0]);
}));
async function mutatePerson(req,res,remove){
  if(!validId(req.params.id))throw fail(400,'Conductor inválido.');
  const values=remove?null:personData(req.body),db=await pool.connect();
  try{
    await db.query('BEGIN');await db.query('LOCK TABLE servicios IN SHARE ROW EXCLUSIVE MODE');
    await db.query('LOCK TABLE conductores,personas_conductoras IN SHARE ROW EXCLUSIVE MODE');
    const person=(await db.query('SELECT * FROM personas_conductoras WHERE id=$1',[req.params.id])).rows[0];
    if(!person)throw fail(404,'Conductor no encontrado.');
    const unit=(await db.query('SELECT id FROM conductores WHERE chofer_id=$1',[person.id])).rows[0];
    if(remove){
      if(unit || (await db.query('SELECT 1 FROM servicios WHERE chofer_id=$1 LIMIT 1',[person.id])).rowCount)throw fail(409,'El conductor está asignado o tiene historial. Desasígnalo y desactívalo para conservar sus servicios.');
      await db.query('DELETE FROM personas_conductoras WHERE id=$1',[person.id]);
    }else{
      if(!values[4] && unit)throw fail(409,'Desasigna al conductor de su unidad antes de desactivarlo.');
      if(unit && (await db.query("SELECT 1 FROM servicios WHERE conductor_id=$1 AND estado NOT IN ('COMPLETADO','CANCELADO')",[unit.id])).rowCount)throw fail(409,'El conductor tiene un servicio activo. Finalízalo antes de editar sus datos.');
      await db.query('UPDATE personas_conductoras SET codigo=$1,nombre=$2,telefono=$3,licencia=$4,activo=$5 WHERE id=$6',[...values,person.id]);
    }
    await db.query('COMMIT');res.json(remove?{eliminado:true}:{actualizado:true});
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
router.put('/personal-conductores/:id',wrap((req,res)=>mutatePerson(req,res,false)));
router.delete('/personal-conductores/:id',wrap((req,res)=>mutatePerson(req,res,true)));
router.put('/unidades/:id/conductor',wrap(async(req,res)=>{
  const personId=req.body.chofer_id;
  if(!validId(req.params.id) || (personId!==null && !validId(personId)))throw fail(400,'Selecciona un conductor válido o Sin conductor.');
  const db=await pool.connect();
  try{
    await db.query('BEGIN');await db.query('LOCK TABLE servicios IN SHARE ROW EXCLUSIVE MODE');
    await db.query('LOCK TABLE conductores,personas_conductoras IN SHARE ROW EXCLUSIVE MODE');
    const unit=(await db.query('SELECT * FROM conductores WHERE id=$1',[req.params.id])).rows[0];
    if(!unit)throw fail(404,'Unidad no encontrada.');
    if((await db.query("SELECT 1 FROM servicios WHERE conductor_id=$1 AND estado NOT IN ('COMPLETADO','CANCELADO')",[unit.id])).rowCount)throw fail(409,'No se puede cambiar el conductor durante un servicio activo.');
    if(personId!==null){
      const person=(await db.query('SELECT * FROM personas_conductoras WHERE id=$1',[personId])).rows[0];
      if(!person || !person.activo)throw fail(409,'El conductor no existe o está inactivo.');
      if((await db.query('SELECT 1 FROM conductores WHERE chofer_id=$1 AND id<>$2',[personId,unit.id])).rowCount)throw fail(409,'El conductor ya está asignado a otra unidad. Desasígnalo primero.');
    }
    await db.query('UPDATE conductores SET chofer_id=$1 WHERE id=$2',[personId,unit.id]);
    await db.query('COMMIT');res.json({asignado:true,chofer_id:personId});
  }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}));
module.exports=router;
