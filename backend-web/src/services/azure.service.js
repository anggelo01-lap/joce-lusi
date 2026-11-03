const axios = require('axios');
const {requireConfig} = require('./integracion.config');
// Text adapter for a separately deployed ACS voice agent. Does not answer PSTN calls.
async function responder(texto, datos={}) {
  requireConfig(['AZURE_AI_ENDPOINT','AZURE_AI_API_KEY','AZURE_AI_DEPLOYMENT']);
  const {data} = await axios.post(`${process.env.AZURE_AI_ENDPOINT.replace(/\/$/,'')}/openai/v1/chat/completions`, {
    model:process.env.AZURE_AI_DEPLOYMENT,
    messages:[{role:'system',content:'Eres la operadora de PlatinumVIP en Trujillo, Perú. Recopila nombre, telefono, origen, destino y categoria (sedan/suv/van). No inventes datos, unidades ni confirmes asignaciones. Devuelve únicamente JSON con respuesta (texto) y datos (objeto con los datos recopilados).'},
      {role:'user',content:JSON.stringify({texto,datos})}], response_format:{type:'json_object'}
  },{headers:{'api-key':process.env.AZURE_AI_API_KEY},timeout:25000});
  const result=JSON.parse(data.choices[0].message.content);
  if(typeof result.respuesta!=='string' || !result.datos || typeof result.datos!=='object' || Array.isArray(result.datos)) throw new Error('Respuesta Azure inválida.');
  return result;
}
module.exports={responder};
