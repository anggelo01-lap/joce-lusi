const axios = require('axios');

async function notificarServicio(servicio) {
  if(require('../db/pool').context.getStore()?.schema?.startsWith('empresa_')) {
    return {enviado:false,modo:'pendiente-configuracion-empresa',channel:'sin-configurar',mensaje:`Nuevo servicio ${servicio.codigo}`};
  }
  const url = process.env.ZELLO_API_URL;
  const token = process.env.ZELLO_API_TOKEN;
  const channel = process.env.ZELLO_CHANNEL || 'taxistas-platinum';
  const mensaje = `Nuevo servicio ${servicio.codigo}: ${servicio.origen || 'origen pendiente'} -> ${servicio.destino || 'destino pendiente'}`;

  if (!url || !token) {
    return { enviado: false, modo: 'pendiente-configuracion', channel, mensaje };
  }

  // Adaptador genérico: ajustar payload cuando se defina el endpoint/API autorizado de Zello.
  const { data } = await axios.post(url, { channel, message: mensaje }, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000
  });
  return { enviado: true, channel, mensaje, respuesta: data };
}
module.exports = { notificarServicio };
