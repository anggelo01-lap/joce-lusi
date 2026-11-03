const express=require('express');
const {timingSafeEqual}=require('crypto');
const pool=require('../db/pool');
const router=express.Router();
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const fail=(status,message)=>Object.assign(new Error(message),{status});
const id=v=>Number.isSafeInteger(Number(v)) && Number(v)>0;
const text=(v,n)=>typeof v==='string' && v.trim().length>0 && v.length<=n;
router.use((req,res,next)=>{
  const expected=Buffer.from(process.env.INTEGRATION_API_TOKEN || ''),actual=Buffer.from(req.get('X-Integration-Token') || '');
  if(!expected.length || expected.length!==actual.length || !timingSafeEqual(expected,actual))return res.status(403).json({error:'Integración no autorizada.'});
  pool.context.run({schema:'public'},next);
});
router.post('/azure/interpretar',wrap(async(req,res)=>{
  if(!text(req.body.texto,4000))throw fail(400,'Texto inválido.');
  res.json(await require('../services/azure.service').responder(req.body.texto,req.body.datos));
}));
router.post('/azure/llamadas',wrap(async(req,res)=>{
  const {external_call_id,telefono,rol,contenido,message_id,estado='EN_CURSO'}=req.body;
  if(!text(external_call_id,150) || !text(telefono,30) || !['RECIBIDA','EN_CURSO','COMPLETADA','FALLIDA'].includes(estado) || (contenido!==undefined && (!text(contenido,4000) || !text(message_id,150) || !['usuario','asistente'].includes(rol))))throw fail(400,'Datos de llamada inválidos.');
  const db=await pool.connect();try {
    await db.query('BEGIN');
    const call=(await db.query(`INSERT INTO llamadas(external_call_id,telefono_origen,estado,fin) VALUES($1,$2,$3::varchar(40),CASE WHEN $3::varchar(40) IN ('COMPLETADA','FALLIDA') THEN NOW() END) ON CONFLICT(external_call_id) DO UPDATE SET estado=CASE WHEN llamadas.fin IS NULL THEN EXCLUDED.estado ELSE llamadas.estado END,fin=COALESCE(llamadas.fin,EXCLUDED.fin) RETURNING *`,[external_call_id,telefono,estado])).rows[0];
    if(contenido!==undefined)await db.query('INSERT INTO conversaciones(llamada_id,rol,contenido,external_id) VALUES($1,$2,$3,$4) ON CONFLICT(llamada_id,external_id) DO NOTHING',[call.id,rol,contenido,message_id]);
    await db.query('COMMIT');res.json(call);
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}));
router.post('/n8n/crear-servicio',(req,res,next)=>{
  if(!text(req.body.external_request_id,150))return next(fail(400,'external_request_id requerido.'));
  req.url='/servicios';require('./api')(req,res,next);
});
router.post('/n8n/buscar-unidad',wrap(async(req,res)=>{
  if(!id(req.body.servicio_id))throw fail(400,'Servicio inválido.');
  const db=await pool.connect();try {
    await db.query('BEGIN');
    const s=(await db.query('SELECT * FROM servicios WHERE id=$1 FOR UPDATE',[req.body.servicio_id])).rows[0];
    if(!s)throw fail(404,'Servicio no encontrado.');if(s.estado!=='SOLICITADO')throw fail(409,'El servicio ya no busca unidad.');
    const previous=(await db.query("SELECT id FROM notificaciones_zello WHERE servicio_id=$1 AND estado='ENVIADO'",[s.id])).rows[0];
    if(previous){await db.query('COMMIT');return res.json({enviado:true,duplicado:true});}
    const aviso=await require('../services/zello.service').enviarSolicitudServicio(s);
    await db.query('INSERT INTO notificaciones_zello(servicio_id,canal,mensaje,estado,respuesta) VALUES($1,$2,$3,$4,$5)',[s.id,aviso.channel,aviso.mensaje,aviso.enviado?'ENVIADO':'PENDIENTE',JSON.stringify(aviso.respuesta || aviso.modo)]);
    if(aviso.enviado){await db.query("UPDATE servicios SET etapa_automatizacion='BUSCANDO_UNIDAD' WHERE id=$1",[s.id]);await db.query("INSERT INTO eventos_servicio(servicio_id,tipo) VALUES($1,'BUSCANDO_UNIDAD')",[s.id]);}
    await db.query('COMMIT');res.status(aviso.enviado?200:503).json(aviso);
  }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}));
router.post('/zello/respuestas',wrap(async(req,res)=>{
  if(!id(req.body.servicio_id) || !text(req.body.external_id,150) || !text(req.body.contenido,2000))throw fail(400,'Respuesta inválida.');res.json(await require('../services/zello.service').recibirRespuesta(req.body));
}));
router.post('/n8n/asignar-conductor',wrap(async(req,res,next)=>{
  if(!id(req.body.respuesta_id))throw fail(400,'Respuesta Zello requerida.');
  const response=(await pool.query('SELECT * FROM respuestas_zello WHERE id=$1',[req.body.respuesta_id])).rows[0];if(!response)throw fail(404,'Respuesta no encontrada.');
  const unit=(await pool.query('SELECT id FROM conductores WHERE lower(codigo)=lower($1)',[response.unidad])).rows[0];if(!unit)throw fail(404,'Unidad no encontrada.');
  req.body={estado:'ASIGNADO',conductor_id:unit.id};req.method='PATCH';req.url=`/servicios/${response.servicio_id}`;require('./operaciones')(req,res,next);
}));
router.post('/n8n/notificar-whatsapp',wrap(async(req,res)=>{
  if(!id(req.body.servicio_id))throw fail(400,'Servicio inválido.');const results=await require('../services/whatsapp.service').notificarAsignacion(req.body.servicio_id);res.status(results.every(r=>['ENVIADO','ENTREGADO','LEIDO'].includes(r.estado))?200:502).json(results);
}));
router.post('/n8n/procesar-pendientes',wrap(async(_req,res)=>res.json(await require('../services/n8n.service').procesarPendientes())));
module.exports=router;
