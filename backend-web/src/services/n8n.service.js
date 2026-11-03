const axios=require('axios');
const pool=require('../db/pool');
const {requireConfig}=require('./integracion.config');
const workflows=['crear-servicio','buscar-unidad','asignar-conductor','notificar-whatsapp'];
async function ejecutar(tipo,payload) {
  if(!workflows.includes(tipo)) throw Object.assign(new Error('Workflow inválido.'),{status:400});
  requireConfig(['N8N_WEBHOOK_URL','N8N_WEBHOOK_TOKEN']);
  const {data}=await axios.post(`${process.env.N8N_WEBHOOK_URL.replace(/\/$/,'')}/webhook/platinum/${tipo}`,payload,{headers:{'X-Platinum-Token':process.env.N8N_WEBHOOK_TOKEN},timeout:20000});
  return data;
}
async function procesarPendientes() {
  const {rows}=await pool.query("SELECT * FROM automatizaciones WHERE estado='PENDIENTE' ORDER BY id LIMIT 20");
  const results=[];
  for(const row of rows) {
    // Keep delivery retryable. Target handlers are idempotent for the same service.
    try {
      const payload={servicio_id:row.servicio_id};
      if(row.tipo==='asignar-conductor')payload.respuesta_id=row.respuesta?.respuesta_id;
      await ejecutar(row.tipo,payload);
      await pool.query("UPDATE automatizaciones SET estado='ENVIADO',respuesta=COALESCE(respuesta,'{}'::jsonb) || $2::jsonb WHERE id=$1",[row.id,JSON.stringify({aceptado:true})]);results.push({id:row.id,enviado:true});
    } catch (_) {
      await pool.query("UPDATE automatizaciones SET respuesta=COALESCE(respuesta,'{}'::jsonb) || '{\"error\":\"No se confirmó la ejecución del workflow\"}'::jsonb WHERE id=$1",[row.id]);
      results.push({id:row.id,enviado:false});
    }
  }
  return results;
}
module.exports={ejecutar,procesarPendientes};
