const axios=require('axios');
const pool=require('../db/pool');
const {enabled}=require('./integracion.config');
async function estado() {
  let db=false,n8n=false;
  await Promise.all([pool.checkPostgres().then(available=>{db=available;}).catch(()=>{}),enabled() && process.env.N8N_WEBHOOK_URL ? axios.get(`${process.env.N8N_WEBHOOK_URL.replace(/\/$/,'')}/healthz`,{timeout:3000}).then(()=>{n8n=true;}).catch(()=>{}) : Promise.resolve()]);
  const configured=(...keys)=>enabled() && keys.every(k=>process.env[k]);
  return [
    {nombre:'PostgreSQL',estado:db?'operativo':'sin conexión',detalle:'Comprobación de base de datos'},
    {nombre:'n8n',estado:n8n?'operativo':'pendiente',detalle:'Disponibilidad HTTP; workflows y credenciales se activan por separado'},
    {nombre:'Azure AI',estado:configured('AZURE_AI_ENDPOINT','AZURE_AI_API_KEY','AZURE_AI_DEPLOYMENT')?'configurado':'pendiente',detalle:'Adaptador de texto preparado; agente de voz externo pendiente de despliegue'},
    {nombre:'Telefonía Azure',estado:configured('AZURE_COMMUNICATION_CONNECTION_STRING','AZURE_PHONE_NUMBER')?'configurado':'pendiente',detalle:'Credenciales locales; recepción de llamadas ACS pendiente de agente y callbacks'},
    {nombre:'Zello',estado:configured('ZELLO_API_URL','ZELLO_API_TOKEN') && process.env.ZELLO_BRIDGE_ENABLED==='true'?'configurado':'pendiente',detalle:'Requiere puente autorizado y modalidad Zello confirmada'},
    {nombre:'WhatsApp',estado:configured('WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_GRAPH_VERSION','WHATSAPP_TEMPLATE_NAME')?'configurado':'pendiente',detalle:'Plantilla aprobada por Meta requerida; envío no comprobado'}
  ];
}
module.exports={estado};
