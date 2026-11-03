const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const router = express.Router();
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res)).catch(next);
router.get('/health', async (_req,res) => {
  try {
    const db = await pool.query('SELECT NOW() AS ahora');
    res.json({ok:true,sistema:'PlatinumVIP',database:true,ahora:db.rows[0].ahora});
  } catch (_) { res.status(503).json({ok:false,database:false,error:'Base de datos no disponible.'}); }
});
router.get(['/conductores','/unidades'], wrap(async (_req,res) => {
  const { rows } = await pool.query("SELECT u.*,COALESCE(p.nombre,'Sin conductor') AS nombre,COALESCE(p.telefono,'') AS telefono,p.activo AS conductor_activo FROM conductores u LEFT JOIN personas_conductoras p ON p.id=u.chofer_id ORDER BY u.id"); res.json(rows);
}));
router.get('/servicios', wrap(async (_req,res) => {
  const { rows } = await pool.query(`SELECT s.*, c.nombre AS cliente, c.telefono AS telefono_cliente, s.conductor_nombre AS conductor, d.placa FROM servicios s LEFT JOIN clientes c ON c.id=s.cliente_id LEFT JOIN conductores d ON d.id=s.conductor_id ORDER BY s.id DESC LIMIT 100`); res.json(rows);
}));
router.post('/servicios', wrap(async (req,res) => {
  const {nombre='Cliente',telefono,origen,destino,categoria='sedan'} = req.body;
  const valid = (v,n) => typeof v==='string' && v.trim().length>0 && v.trim().length<=n;
  if (!valid(nombre,120) || !valid(telefono,30) || !valid(origen,500) || !valid(destino,500) || !['sedan','suv','van'].includes(categoria)) return res.status(400).json({error:'Revisa nombre, teléfono, origen, destino y categoría.'});
  const db = await pool.connect(); let service;
  try {
    await db.query('BEGIN');
    if(req.body.external_request_id) {
      if(typeof req.body.external_request_id!=='string' || req.body.external_request_id.length>150) throw Object.assign(new Error('external_request_id inválido.'),{status:400});
      await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[req.body.external_request_id]);
      const previous=(await db.query('SELECT * FROM servicios WHERE external_request_id=$1',[req.body.external_request_id])).rows[0];
      if(previous){await db.query('COMMIT');return res.json({...previous,zello:{enviado:false,modo:'automatizacion-pendiente'},duplicado:true});}
    }
    const client = await db.query(`INSERT INTO clientes(nombre,telefono) VALUES($1,$2) ON CONFLICT(telefono) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id`,[nombre.trim(),telefono.trim()]);
    const codigo = `SRV-${randomUUID().replace(/-/g,'').slice(0,24).toUpperCase()}`;
    service = (await db.query(`INSERT INTO servicios(codigo,cliente_id,origen,destino,categoria,external_request_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[codigo,client.rows[0].id,origen.trim(),destino.trim(),categoria,req.body.external_request_id || null])).rows[0];
    await db.query('COMMIT');
  } catch(error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
  res.status(201).json({...service,zello:{enviado:false,modo:'automatizacion-pendiente',registro:true}});
}));
module.exports = router;
