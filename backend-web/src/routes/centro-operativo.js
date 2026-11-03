const express = require('express');
const pool = require('../db/pool');
const router = express.Router();
const status = value => String(value || '').toUpperCase().replaceAll(' ', '_');
const phone = value => String(value || '').replace(/\D/g, '');
const responses = [];
const error = (res, code, message) => res.status(code).json({error:message});
const audit = (req, action) => pool.store.auditoria.unshift({id:Date.now(),usuario:req.access?.nombre || 'Operador',modulo:'Despacho',accion:action,estado:'OK',creado_en:new Date()});
router.get('/centro/llamadas', (_req,res) => {
  res.json(pool.store.llamadas.map(call => {
    const client = pool.store.clientes.find(c=>c.id===call.cliente_id || (phone(c.telefono) && phone(c.telefono)===phone(call.telefono_origen)));
    return {...call,cliente:client?.nombre || call.datos_extraidos?.nombre || 'Sin identificar',solicitudes:pool.store.servicios.filter(s=>s.llamada_id===call.id)};
  }));
});
router.get('/centro/pasajeros/:id/historial', (req,res) => {
  const client=pool.store.clientes.find(c=>c.id===Number(req.params.id));
  if(!client)return error(res,404,'Pasajero no encontrado.');
  const samePhone=value=>phone(client.telefono) && phone(value)===phone(client.telefono);
  const calls=pool.store.llamadas.filter(c=>c.cliente_id===client.id || samePhone(c.telefono_origen));
  const services=pool.store.servicios.filter(s=>s.cliente_id===client.id || samePhone(s.telefono_cliente));
  res.json({cliente:client,llamadas:calls,servicios:services,totales:{llamadas:calls.length,servicios:services.length,completados:services.filter(s=>status(s.estado)==='COMPLETADO').length,cancelados:services.filter(s=>status(s.estado)==='CANCELADO').length}});
});
router.get('/centro/disponibilidad', (_req,res)=>res.json(responses));
router.post('/centro/disponibilidad', (req,res)=>{
  const {servicio_id,conductor_id,disponible,contenido}=req.body;
  const service=pool.store.servicios.find(s=>s.id===Number(servicio_id));
  const driver=pool.store.conductores.find(c=>c.id===Number(conductor_id));
  if(!service || !driver || typeof disponible!=='boolean' || typeof contenido!=='string' || !contenido.trim() || contenido.length>1000)return error(res,400,'Selecciona servicio, unidad y respuesta reportada.');
  if(['COMPLETADO','CANCELADO'].includes(status(service.estado)))return error(res,409,'El servicio ya está cerrado.');
  const response={id:Math.max(0,...responses.map(r=>r.id))+1,servicio_id:service.id,conductor_id:driver.id,unidad:driver.codigo,conductor:driver.nombre,disponible,contenido:contenido.trim(),fuente:'registro_manual_zello',creado_en:new Date()};
  responses.push(response);
  driver.disponibilidad_reportada=disponible;driver.disponibilidad_en=response.creado_en;
  audit(req,`Respuesta reportada de ${driver.codigo} para ${service.codigo}`);
  res.status(201).json(response);
});
router.post('/centro/asignaciones', (req,res)=>{
  const response=responses.find(r=>r.id===Number(req.body.respuesta_id));
  if(!response || !response.disponible)return error(res,400,'Se requiere una respuesta disponible.');
  const latest=responses.filter(r=>r.servicio_id===response.servicio_id && r.conductor_id===response.conductor_id).at(-1);
  if(latest.id!==response.id)return error(res,409,'Selecciona la respuesta más reciente.');
  if(Date.now()-new Date(response.creado_en).getTime()>15*60*1000)return error(res,409,'La disponibilidad venció. Registra una respuesta actualizada.');
  const service=pool.store.servicios.find(s=>s.id===response.servicio_id),driver=pool.store.conductores.find(c=>c.id===response.conductor_id);
  if(!service || !driver)return error(res,404,'Servicio o unidad no encontrado.');
  if(['COMPLETADO','CANCELADO','EN_CURSO'].includes(status(service.estado)))return error(res,409,'El servicio no permite asignación.');
  if(pool.store.servicios.some(s=>s.id!==service.id && s.conductor_id===driver.id && ['ASIGNADO','EN_CURSO'].includes(status(s.estado))))return error(res,409,'La unidad tiene otro servicio activo.');
  if(service.conductor_id && service.conductor_id!==driver.id){const previous=pool.store.conductores.find(c=>c.id===service.conductor_id);if(previous)previous.estado='DISPONIBLE';}
  Object.assign(service,{conductor_id:driver.id,conductor:driver.nombre,unidad_codigo:driver.codigo,placa:driver.placa,estado:'Asignado',respuesta_zello_id:response.id,actualizado_en:new Date()});
  driver.estado='EN_SERVICIO';audit(req,`${service.codigo} asignado a ${driver.codigo}`);res.json(service);
});
router.put('/centro/servicios/:id/puntos', (req,res)=>{
  const service=pool.store.servicios.find(s=>s.id===Number(req.params.id));
  if(!service)return error(res,404,'Servicio no encontrado.');
  const point=p=>p && typeof p.lat==='number' && typeof p.lng==='number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat)<=90 && Math.abs(p.lng)<=180;
  if(!point(req.body.recojo) || !point(req.body.destino))return error(res,400,'Indica coordenadas válidas de recojo y destino.');
  service.puntos={recojo:req.body.recojo,destino:req.body.destino};service.actualizado_en=new Date();res.json(service);
});
module.exports=router;
