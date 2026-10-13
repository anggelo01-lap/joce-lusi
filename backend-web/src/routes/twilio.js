const express = require('express');
const twilio = require('twilio');
const pool = require('../db/pool');
const { responder } = require('../services/orion.service');
const router = express.Router();

router.post('/voice', async (req,res) => {
  const vr = new twilio.twiml.VoiceResponse();
  const callSid = req.body.CallSid || null;
  const from = req.body.From || 'DESCONOCIDO';

  try {
    const cli = await pool.query(
      `INSERT INTO clientes(nombre,telefono) VALUES('Cliente telefónico',$1)
       ON CONFLICT(telefono) DO UPDATE SET telefono=EXCLUDED.telefono RETURNING id`, [from]);
    if (callSid) await pool.query(
      `INSERT INTO llamadas(cliente_id,twilio_call_sid,telefono_origen)
       VALUES($1,$2,$3) ON CONFLICT(twilio_call_sid) DO NOTHING`, [cli.rows[0].id,callSid,from]);
  } catch (_) {}

  const gather = vr.gather({
    input: 'speech',
    language: 'es-PE',
    speechTimeout: 'auto',
    action: '/api/twilio/process',
    method: 'POST'
  });
  gather.say({language:'es-MX'}, 'Bienvenido a Platinum VIP. Soy Orión, su asistente virtual. Indíqueme desde dónde desea el taxi y cuál es su destino.');
  vr.redirect({method:'POST'}, '/api/twilio/voice');
  res.type('text/xml').send(vr.toString());
});

router.post('/process', async (req,res) => {
  const vr = new twilio.twiml.VoiceResponse();
  const texto = req.body.SpeechResult || '';
  const callSid = req.body.CallSid || null;
  let respuesta = 'No pude procesar la solicitud. Por favor, repítala.';
  try {
    const ia = await responder(texto, { canal:'twilio', call_sid:callSid });
    respuesta = ia.respuesta || respuesta;
    if (callSid) {
      const l = await pool.query('SELECT id FROM llamadas WHERE twilio_call_sid=$1',[callSid]);
      if (l.rows[0]) {
        await pool.query('UPDATE llamadas SET transcripcion=COALESCE(transcripcion,\'\') || $1 WHERE id=$2',
          [`\nCLIENTE: ${texto}\nORION: ${respuesta}`, l.rows[0].id]);
        await pool.query('INSERT INTO conversaciones(llamada_id,rol,contenido) VALUES($1,$2,$3),($1,$4,$5)',
          [l.rows[0].id,'usuario',texto,'asistente',respuesta]);
      }
    }
  } catch (e) {
    respuesta = 'El asistente está temporalmente ocupado. Intentemos nuevamente.';
  }
  vr.say({language:'es-MX'}, respuesta);
  vr.redirect({method:'POST'}, '/api/twilio/voice');
  res.type('text/xml').send(vr.toString());
});

module.exports = router;
