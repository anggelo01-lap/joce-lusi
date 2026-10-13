const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const { notificarServicio } = require('../services/zello.service');
const router = express.Router();
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
router.get('/health', async (_req,res) => {
  try {
    const db = await pool.query('SELECT NOW() AS ahora');
    res.json({ok:true,sistema:'PlatinumVIP',database:true,ahora:db.rows[0].ahora});
  } catch (_) { res.status(503).json({ok:false,database:false,error:'Base de datos no disponible.'}); }
});
router.get('/conductores', wrap(async (_req,res) => {
  const { rows } = await pool.query('SELECT * FROM conductores ORDER BY id'); res.json(rows);
}));
router.get('/servicios', wrap(async (_req,res) => {
  const { rows } = await pool.query(`SELECT s.*, c.nombre AS cliente, c.telefono AS telefono_cliente, d.nombre AS conductor, d.placa FROM servicios s LEFT JOIN clientes c ON c.id=s.cliente_id LEFT JOIN conductores d ON d.id=s.conductor_id ORDER BY s.id DESC LIMIT 100`); res.json(rows);
}));
router.post('/servicios', wrap(async (req,res) => {
  const {nombre='Cliente',telefono,origen,destino,categoria='sedan'} = req.body;
  const valid = (v,n) => typeof v==='string' && v.trim().length>0 && v.trim().length<=n;
  if (!valid(nombre,120) || !valid(telefono,30) || !valid(origen,500) || !valid(destino,500) || !['sedan','suv','van'].includes(categoria)) return res.status(400).json({error:'Revisa nombre, teléfono, origen, destino y categoría.'});
  const db = await pool.connect(); let service;
  try {
    await db.query('BEGIN');
    const client = await db.query(`INSERT INTO clientes(nombre,telefono) VALUES($1,$2) ON CONFLICT(telefono) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id`,[nombre.trim(),telefono.trim()]);
    const codigo = `SRV-${randomUUID().replace(/-/g,'').slice(0,24).toUpperCase()}`;
    service = (await db.query(`INSERT INTO servicios(codigo,cliente_id,origen,destino,categoria) VALUES($1,$2,$3,$4,$5) RETURNING *`,[codigo,client.rows[0].id,origen.trim(),destino.trim(),categoria])).rows[0];
    await db.query('COMMIT');
  } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  let aviso;
  try { aviso = await notificarServicio(service); }
  catch (_) { aviso = {enviado:false,modo:'error-proveedor',channel:process.env.ZELLO_CHANNEL || 'taxistas-platinum',mensaje:`Nuevo servicio ${service.codigo}: ${service.origen} -> ${service.destino}`}; }
  let registroNotificacion = true;
  try {
    await pool.query(`INSERT INTO notificaciones_zello(servicio_id,canal,mensaje,estado,respuesta) VALUES($1,$2,$3,$4,$5)`,[service.id,aviso.channel,aviso.mensaje,aviso.enviado?'ENVIADO':'PENDIENTE',JSON.stringify(aviso.respuesta || aviso.modo)]);
  } catch (_) { registroNotificacion = false; }
  res.status(201).json({...service,zello:{enviado:aviso.enviado,modo:aviso.modo,registro:registroNotificacion}});
}));
module.exports = router;
