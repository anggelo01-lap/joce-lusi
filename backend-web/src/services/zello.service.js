const axios=require('axios');
const pool=require('../db/pool');
const {requireConfig}=require('./integracion.config');
function identificarUnidad(texto) { return String(texto).match(/\bunidad\s+([a-z0-9-]{1,30})\b/i)?.[1] || null; }
async function bridge(action,payload) {
  requireConfig(['ZELLO_API_URL','ZELLO_API_TOKEN']);
  if(process.env.ZELLO_BRIDGE_ENABLED!=='true') throw Object.assign(new Error('Confirma la modalidad y el puente autorizado de Zello.'),{status:503});
  const {data}=await axios.post(process.env.ZELLO_API_URL,{action,channel:process.env.ZELLO_CHANNEL || 'taxistas-platinum',...payload},{headers:{Authorization:`Bearer ${process.env.ZELLO_API_TOKEN}`},timeout:10000});return data;
}
async function enviarSolicitudServicio(s) {
  const channel=process.env.ZELLO_CHANNEL || 'taxistas-platinum';
  const mensaje=`Servicio ${s.codigo}. Recojo: ${s.origen}. Destino: ${s.destino}. Categoría: ${s.categoria}. ¿Unidad disponible?`;
  try { return {enviado:true,channel,mensaje,respuesta:await bridge('enviarSolicitudServicio',{servicio_id:s.id,message:mensaje})}; }
  catch(e) { if(e.status===503)return {enviado:false,channel,mensaje,modo:'pendiente-configuracion'};throw e; }
}
async function recibirRespuesta({external_id,servicio_id,contenido}) {
  const unidad=identificarUnidad(contenido);
  if(!unidad)throw Object.assign(new Error('La respuesta debe identificar una unidad.'),{status:400});
  const {rows}=await pool.query(`INSERT INTO respuestas_zello(external_id,servicio_id,unidad,contenido) VALUES($1,$2,$3,$4) ON CONFLICT(external_id) DO UPDATE SET external_id=EXCLUDED.external_id RETURNING *`,[external_id,servicio_id,unidad,contenido]);
  if(rows[0].servicio_id!==Number(servicio_id) || rows[0].contenido!==contenido)throw Object.assign(new Error('Identificador reutilizado.'),{status:409});
  await pool.query(`INSERT INTO automatizaciones(servicio_id,tipo,respuesta) VALUES($1,'asignar-conductor',$2) ON CONFLICT DO NOTHING`,[servicio_id,JSON.stringify({respuesta_id:rows[0].id})]);
  return rows[0];
}
module.exports={identificarUnidad,enviarSolicitudServicio,notificarServicio:enviarSolicitudServicio,recibirRespuesta,confirmarAsignacion:p=>bridge('confirmarAsignacion',p),cerrarSolicitud:p=>bridge('cerrarSolicitud',p)};
