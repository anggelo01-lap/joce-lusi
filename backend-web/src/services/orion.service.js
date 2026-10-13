const axios = require('axios');
const ORION_URL = process.env.ORION_URL || 'http://orion:8000';

async function responder(texto, contexto = {}) {
  const { data } = await axios.post(`${ORION_URL}/api/chat`, { texto, contexto }, { timeout: 20000 });
  return data;
}
module.exports = { responder };
