const axios=require('axios');
const pool=require('../db/pool');
const {requireConfig}=require('./integracion.config');
async function notificarAsignacion(servicioId) {
  requireConfig(['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_GRAPH_VERSION','WHATSAPP_TEMPLATE_NAME']);
  const s=(await pool.query(`SELECT s.*,c.telefono AS cliente_telefono,p.telefono AS conductor_telefono FROM servicios s JOIN clientes c ON c.id=s.cliente_id LEFT JOIN personas_conductoras p ON p.id=s.chofer_id WHERE s.id=$1`,[servicioId])).rows[0];
  if(!s)throw Object.assign(new Error('Servicio no encontrado.'),{status:404});
  if(!s.conductor_id || ['CANCELADO','COMPLETADO'].includes(s.estado))throw Object.assign(new Error('Sin asignación activa.'),{status:409});
  const results=[];
  for(const destinatario of ['cliente','conductor']) {
    const telefono=String(s[`${destinatario}_telefono`] || '').replace(/^\+/,'');
    if(!/^[1-9]\d{7,14}$/.test(telefono)){results.push({destinatario,estado:'TELEFONO_INVALIDO'});continue;}
    await pool.query('INSERT INTO notificaciones_whatsapp(servicio_id,destinatario,telefono) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[s.id,destinatario,telefono]);
    const claimed=(await pool.query("UPDATE notificaciones_whatsapp SET estado='ENVIANDO',actualizado_en=NOW() WHERE servicio_id=$1 AND destinatario=$2 AND estado IN ('PENDIENTE','ERROR') RETURNING *",[s.id,destinatario])).rows[0];
    if(!claimed){const previous=(await pool.query('SELECT estado FROM notificaciones_whatsapp WHERE servicio_id=$1 AND destinatario=$2',[s.id,destinatario])).rows[0];results.push({destinatario,estado:previous.estado});continue;}
    try {
      const {data}=await axios.post(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{messaging_product:'whatsapp',to:telefono,type:'template',template:{name:process.env.WHATSAPP_TEMPLATE_NAME,language:{code:process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es_PE'},components:[{type:'body',parameters:[s.codigo,s.origen,s.destino,s.conductor_nombre || ''].map(text=>({type:'text',text}))}]}},{headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`},timeout:15000});
      const external=data.messages?.[0]?.id;if(!external)throw new Error('Sin confirmación');
      await pool.query("UPDATE notificaciones_whatsapp SET estado='ENVIADO',external_id=$2,error=NULL,actualizado_en=NOW() WHERE id=$1",[claimed.id,external]);
      await pool.query('INSERT INTO eventos_servicio(servicio_id,tipo) VALUES($1,$2)',[s.id,`${destinatario.toUpperCase()}_NOTIFICADO`]);results.push({destinatario,estado:'ENVIADO'});
    } catch(e) {
      const estado=e.response?'ERROR':'INCIERTO';
      await pool.query('UPDATE notificaciones_whatsapp SET estado=$2,error=$3,actualizado_en=NOW() WHERE id=$1',[claimed.id,estado,'No se confirmó el envío; revisar proveedor.']);results.push({destinatario,estado});
    }
  }
  return results;
}
module.exports={notificarAsignacion};
