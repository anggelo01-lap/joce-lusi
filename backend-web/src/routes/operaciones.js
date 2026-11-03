const express = require('express');
const pool = require('../db/pool');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// ============================================================================
// 1. PANEL PRINCIPAL: Resumen y Métricas Oficiales
// ============================================================================
router.get('/resumen', wrap(async (_req, res) => {
  const store = pool.store;
  const day = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat('en-CA', {timeZone:'America/Lima'}).format(d); };
  const today = day(new Date());
  const status = s => String(s.estado || '').toUpperCase().replaceAll(' ', '_');
  const services = store.servicios;
  const daily = services.filter(s => day(s.creado_en) === today);
  const completed = daily.filter(s => status(s) === 'COMPLETADO');
  res.json({
    fuente: 'memoria', persistente: false,
    servicios: {
      activos: services.filter(s => !['COMPLETADO','CANCELADO'].includes(status(s))).length,
      hoy: daily.length,
      completados_hoy: completed.length,
      cancelados_hoy: daily.filter(s => status(s) === 'CANCELADO').length,
      facturado_hoy: completed.reduce((sum,s) => sum + (Number(s.tarifa) || 0), 0)
    },
    unidades: {total:store.conductores.length, disponibles:store.conductores.filter(s => status(s) === 'DISPONIBLE').length},
    llamadas: {hoy:store.llamadas.filter(s => day(s.inicio) === today).length},
    actualizado_en: new Date().toISOString()
  });
}));

// ============================================================================
// 2. CRUD SERVICIOS / SOLICITUDES
// ============================================================================
router.get('/servicios', wrap(async (_req, res) => {
  res.json(pool.store.servicios);
}));

router.get('/servicios/:id', wrap(async (req, res) => {
  const s = pool.store.servicios.find(x => x.id === Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'Servicio no encontrado.' });
  res.json(s);
}));

// CREATE
router.post('/servicios', wrap(async (req, res) => {
  const store = pool.store;
  const {
    cliente = '',
    telefono_cliente = '',
    origen = '',
    destino = '',
    referencia = '',
    unidad_codigo = 'U-12',
    categoria = 'sedan',
    estado = 'Asignado',
    tarifa = 0
  } = req.body;

  if (![cliente,telefono_cliente,origen,destino].every(v=>typeof v==='string' && v.trim() && v.length<=500) || !Number.isFinite(Number(tarifa)) || Number(tarifa)<0) return res.status(400).json({error:'Revisa cliente, contacto, direcciones y tarifa.'});
  const digits=value=>String(value || '').replace(/\D/g,'');
  let passenger=store.clientes.find(p=>digits(p.telefono)===digits(telefono_cliente));
  if(!passenger){passenger={id:Math.max(0,...store.clientes.map(p=>p.id))+1,nombre:cliente,telefono:telefono_cliente,tipo:'Telefonico',notas:'',creado_en:new Date(),total_viajes:0};store.clientes.push(passenger);}
  const linkedCall=req.body.llamada_id == null ? null : store.llamadas.find(c=>c.id===Number(req.body.llamada_id) && digits(c.telefono_origen)===digits(telefono_cliente));
  if(req.body.llamada_id != null && !linkedCall)return res.status(400).json({error:'La llamada no corresponde al contacto.'});
  const nextId = (Math.max(...store.servicios.map(s => s.id), 48)) + 1;
  const nuevo = {
    id: nextId,
    codigo: `SRV-${new Date().getFullYear()}-${String(nextId).padStart(4, '0')}`,
    cliente_id: passenger.id,
    cliente,
    telefono_cliente,
    conductor_id: null,
    conductor: null,
    placa: null,
    unidad_codigo: null,
    llamada_id: linkedCall?.id || null,
    origen,
    destino,
    referencia,
    categoria,
    estado: 'Solicitado',
    tarifa: Number(tarifa),
    creado_en: new Date(),
    actualizado_en: new Date()
  };

  store.servicios.unshift(nuevo);

  store.auditoria.unshift({
    id: store.auditoria.length + 1,
    usuario: 'Administrador',
    rol: 'admin',
    modulo: 'Solicitudes',
    accion: `Servicio ${nuevo.codigo} creado (CRUD Admin)`,
    detalle: `Pasajero: ${nuevo.cliente}. ${nuevo.origen} -> ${nuevo.destino}`,
    ip: '127.0.0.1',
    estado: 'OK',
    creado_en: new Date()
  });

  res.status(201).json(nuevo);
}));

// UPDATE (PUT)
router.put('/servicios/:id', wrap(async (req, res) => {
  const store = pool.store;
  const id = Number(req.params.id);
  const idx = store.servicios.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Servicio no encontrado.' });

  const prev = store.servicios[idx];
  if(req.body.unidad_codigo && req.body.unidad_codigo !== prev.unidad_codigo)return res.status(409).json({error:'Asigna la unidad desde las respuestas de disponibilidad.'});
  if(req.body.tarifa !== undefined && (!Number.isFinite(Number(req.body.tarifa)) || Number(req.body.tarifa)<0))return res.status(400).json({error:'Tarifa invalida.'});

  const updated = {
    ...prev,
    cliente: req.body.cliente !== undefined ? req.body.cliente : prev.cliente,
    telefono_cliente: req.body.telefono_cliente !== undefined ? req.body.telefono_cliente : prev.telefono_cliente,
    origen: req.body.origen !== undefined ? req.body.origen : prev.origen,
    destino: req.body.destino !== undefined ? req.body.destino : prev.destino,
    unidad_codigo: req.body.unidad_codigo !== undefined ? req.body.unidad_codigo : prev.unidad_codigo,
    estado: req.body.estado !== undefined ? req.body.estado : prev.estado,
    tarifa: req.body.tarifa !== undefined ? Number(req.body.tarifa) : prev.tarifa,
    referencia: req.body.referencia !== undefined ? req.body.referencia : prev.referencia,
    actualizado_en: new Date()
  };

  store.servicios[idx] = updated;
  if(['COMPLETADO','CANCELADO'].includes(String(updated.estado).toUpperCase()) && updated.conductor_id){const driver=store.conductores.find(c=>c.id===updated.conductor_id);if(driver)driver.estado='DISPONIBLE';}


  store.auditoria.unshift({
    id: store.auditoria.length + 1,
    usuario: 'Administrador',
    rol: 'admin',
    modulo: 'Solicitudes',
    accion: `Servicio ${updated.codigo} actualizado (CRUD Admin)`,
    detalle: `Estado: ${updated.estado}, Unidad: ${updated.unidad_codigo}, Tarifa: S/${updated.tarifa}`,
    ip: '127.0.0.1',
    estado: 'OK',
    creado_en: new Date()
  });

  res.json(updated);
}));

// PATCH (Partial Update / Estado rápido)
router.patch('/servicios/:id', wrap(async (req, res) => {
  const store = pool.store;
  const id = Number(req.params.id);
  const servicio = store.servicios.find(s => s.id === id);
  if (!servicio) return res.status(404).json({ error: 'Servicio no encontrado.' });

  if (req.body.estado) servicio.estado = req.body.estado;
  if (req.body.unidad_codigo) servicio.unidad_codigo = req.body.unidad_codigo;
  if (req.body.tarifa !== undefined) servicio.tarifa = Number(req.body.tarifa);
  servicio.actualizado_en = new Date();

  res.json(servicio);
}));

// DELETE
router.delete('/servicios/:id', wrap(async (req, res) => {
  const store = pool.store;
  const id = Number(req.params.id);
  const idx = store.servicios.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Servicio no encontrado.' });

  const [deleted] = store.servicios.splice(idx, 1);

  store.auditoria.unshift({
    id: store.auditoria.length + 1,
    usuario: 'Administrador',
    rol: 'admin',
    modulo: 'Solicitudes',
    accion: `Servicio ${deleted.codigo} eliminado (CRUD Admin)`,
    detalle: `Pasajero: ${deleted.cliente}`,
    ip: '127.0.0.1',
    estado: 'OK',
    creado_en: new Date()
  });

  res.json({ ok: true, deleted_id: id });
}));

// ============================================================================
// 3. CRUD CONDUCTORES Y UNIDADES
// ============================================================================
router.get(['/conductores', '/unidades'], wrap(async (_req, res) => {
  res.json(pool.store.conductores);
}));

router.post(['/conductores', '/unidades'], wrap(async (req, res) => {
  const store = pool.store;
  const { codigo, nombre, telefono, placa, vehiculo, categoria = 'sedan' } = req.body;
  if (![codigo,nombre,telefono,placa,vehiculo].every(v=>typeof v==='string' && v.trim() && v.length<=150)) return res.status(400).json({ error: 'Código, nombre y placa son requeridos.' });

  const nuevo = {
    id: Math.max(0, ...store.conductores.map(c=>c.id)) + 1,
    codigo,
    nombre,
    telefono: telefono,
    placa: placa.toUpperCase(),
    vehiculo: vehiculo,
    categoria,
    canal_zello: 'taxistas-platinum',
    zello_usuario: codigo.toLowerCase().replace(/ /g, '.'),
    estado: 'DISPONIBLE',
    latitud: null,
    longitud: null,
    ubicacion_en: null,
    total_servicios: 0,
    calificacion: 5.0
  };

  store.conductores.unshift(nuevo);
  res.status(201).json(nuevo);
}));

router.put(['/conductores/:id', '/unidades/:id'], wrap(async (req, res) => {
  const store = pool.store;
  const id = Number(req.params.id);
  const c = store.conductores.find(x => x.id === id);
  if (!c) return res.status(404).json({ error: 'Unidad no encontrada.' });

  if (req.body.nombre) c.nombre = req.body.nombre;
  if (req.body.codigo) c.codigo = req.body.codigo;
  if (req.body.placa) c.placa = req.body.placa.toUpperCase();
  if (req.body.vehiculo) c.vehiculo = req.body.vehiculo;
  if (req.body.estado) c.estado = req.body.estado;
  if (req.body.telefono) c.telefono = req.body.telefono;

  res.json(c);
}));

router.delete(['/conductores/:id', '/unidades/:id'], wrap(async (req, res) => {
  const store = pool.store;
  const id = Number(req.params.id);
  const idx = store.conductores.findIndex(c => c.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Unidad no encontrada.' });
  const [deleted] = store.conductores.splice(idx, 1);
  res.json({ ok: true, deleted_id: id });
}));

// ============================================================================
// 4. CRUD PASAJEROS
// ============================================================================
router.get('/pasajeros', wrap(async (_req, res) => {
  res.json(pool.store.clientes);
}));

router.post('/pasajeros', wrap(async (req, res) => {
  const store = pool.store;
  const { nombre, telefono, tipo = 'VIP', notas } = req.body;
  if (!nombre || !telefono) return res.status(400).json({ error: 'Nombre y teléfono requeridos.' });

  const nuevo = {
    id: Math.max(0, ...store.clientes.map(c=>c.id)) + 1,
    nombre,
    telefono,
    tipo,
    notas: notas || 'Cliente corporativo',
    total_viajes: 0,
    destinos_frecuentes: ['Centro Histórico', 'Mall Plaza'],
    creado_en: new Date()
  };

  store.clientes.unshift(nuevo);
  res.status(201).json(nuevo);
}));

router.put('/pasajeros/:id', wrap(async (req, res) => {
  const store = pool.store;
  const id = Number(req.params.id);
  const p = store.clientes.find(x => x.id === id);
  if (!p) return res.status(404).json({ error: 'Pasajero no encontrado.' });

  if (req.body.nombre) p.nombre = req.body.nombre;
  if (req.body.telefono) p.telefono = req.body.telefono;
  if (req.body.tipo) p.tipo = req.body.tipo;
  if (req.body.notas) p.notas = req.body.notas;

  res.json(p);
}));

router.delete('/pasajeros/:id', wrap(async (req, res) => {
  const store = pool.store;
  const id = Number(req.params.id);
  const idx = store.clientes.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Pasajero no encontrado.' });
  store.clientes.splice(idx, 1);
  res.json({ ok: true, deleted_id: id });
}));

// ============================================================================
// 5. CRUD USUARIOS Y ROLES
// ============================================================================
router.get('/usuarios', wrap(async (_req, res) => {
  res.json(pool.store.cuentas);
}));

router.post('/usuarios', wrap(async (req, res) => {
  const store = pool.store;
  const { nombre, email, rol = 'operador' } = req.body;
  if (!nombre?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) return res.status(400).json({error:'Nombre y correo requeridos.'});
  if (store.cuentas.some(u=>u.email?.toLowerCase() === email.toLowerCase())) return res.status(409).json({error:'El correo ya existe.'});
  const user = { id: Math.max(0, ...store.cuentas.map(c=>c.id)) + 1, nombre, email, rol, activo: true, creado_en: new Date() };
  store.cuentas.push(user);
  res.status(201).json(user);
}));

router.put('/usuarios/:id', wrap(async (req, res) => {
  const store = pool.store;
  const id = Number(req.params.id);
  const u = store.cuentas.find(x => x.id === id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado.' });
  if (req.body.nombre) u.nombre = req.body.nombre;
  if (req.body.rol) u.rol = req.body.rol;
  if (req.body.activo !== undefined) u.activo = Boolean(req.body.activo);
  res.json(u);
}));

router.delete('/usuarios/:id', wrap(async (req, res) => {
  const store = pool.store;
  const id = Number(req.params.id);
  const idx = store.cuentas.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado.' });
  store.cuentas.splice(idx, 1);
  res.json({ ok: true, deleted_id: id });
}));

// ============================================================================
// 6. LLAMADAS Y AUDITORÍA
// ============================================================================
router.get('/conexiones', wrap(async (_req,res) => res.json(await require('../services/conexiones.service').estado())));

router.get('/llamadas', wrap(async (_req, res) => res.json(pool.store.llamadas)));
router.get('/auditoria', wrap(async (_req, res) => res.json(pool.store.auditoria)));

router.post('/llamadas/simular', wrap(async (req, res) => {
  const store = pool.store;
  const { nombre = 'Carlos Mendoza', telefono = '+51 944 821 302', punto_recojo = 'Av. España 320', destino = 'Mall Plaza' } = req.body;
  const call = {
    id: store.llamadas.length + 1,
    external_call_id: `ACS-${Date.now().toString().slice(-6)}`,
    cliente_id: 1,
    telefono_origen: telefono,
    agente_voz: 'Azure AI Voice Agent',
    transcripcion: `Llamada entrante de ${nombre} hacia ${destino}.`,
    resumen_ia: `Traslado a ${destino}`,
    datos_extraidos: { nombre, telefono, punto_recojo, destino, referencia: 'Llamada telefónica' },
    duracion_segundos: 32,
    sentimiento: 'POSITIVO',
    csat_score: 5.0,
    estado: 'COMPLETADA',
    inicio: new Date(),
    fin: new Date()
  };
  store.llamadas.unshift(call);
  res.status(201).json(call);
}));

module.exports = router;
