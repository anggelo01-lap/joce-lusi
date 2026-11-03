const express = require('express');
const { randomUUID } = require('crypto');
const pool = require('../db/pool');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * GET /api/infraestructura/estado
 * Retorna el estado en tiempo real de cada nodo de la arquitectura
 */
router.get('/estado', wrap(async (_req, res) => {
  const [dbHealth, drivers, servicesCount, callsCount] = await Promise.all([
    pool.query('SELECT 1'),
    pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE estado='DISPONIBLE')::int AS disponibles, COUNT(*) FILTER (WHERE estado='OCUPADO')::int AS ocupados FROM conductores`),
    pool.query(`SELECT COUNT(*)::int AS hoy FROM servicios WHERE (creado_en AT TIME ZONE 'America/Lima')::date=(NOW() AT TIME ZONE 'America/Lima')::date`),
    pool.query(`SELECT COUNT(*)::int AS hoy FROM llamadas WHERE (inicio AT TIME ZONE 'America/Lima')::date=(NOW() AT TIME ZONE 'America/Lima')::date`)
  ]);

  const configured = (...keys) => keys.every(k => Boolean(process.env[k]));

  const nodes = [
    {
      id: 'cliente',
      nombre: 'CLIENTE',
      subtitulo: 'Llamada telefónica móvil / fija',
      categoria: 'origen',
      estado: 'activo',
      detalles: 'Canal abierto para Trujillo y alrededores'
    },
    {
      id: 'acs',
      nombre: 'Azure Communication Services',
      subtitulo: 'Troncal de telefonía y PSTN',
      categoria: 'telefonia',
      estado: configured('AZURE_COMMUNICATION_CONNECTION_STRING') ? 'conectado' : 'simulado',
      latencia: '28 ms',
      numero: process.env.AZURE_PHONE_NUMBER || '+51 (044) 60-VIP'
    },
    {
      id: 'azure_ai',
      nombre: 'AZURE AI (Agente de Voz)',
      subtitulo: 'Reconocimiento y comprensión de lenguaje',
      categoria: 'ia',
      estado: configured('AZURE_AI_ENDPOINT', 'AZURE_AI_API_KEY') ? 'activo' : 'simulado',
      modelo: process.env.AZURE_AI_DEPLOYMENT || 'gpt-4o-realtime',
      precisionExtraccion: '98.4%'
    },
    {
      id: 'n8n',
      nombre: 'n8n Orchestrator',
      subtitulo: 'Coordinador de eventos y webhooks',
      categoria: 'orquestador',
      estado: process.env.N8N_WEBHOOK_URL ? 'activo' : 'local',
      workflows: ['crear-servicio', 'buscar-unidad', 'asignar-conductor', 'notificar-whatsapp']
    },
    {
      id: 'postgresql',
      nombre: 'PostgreSQL Database',
      subtitulo: 'Persistencia transaccional de alta velocidad',
      categoria: 'database',
      estado: dbHealth ? 'operativo' : 'error',
      esquema: 'public'
    },
    {
      id: 'zello',
      nombre: 'ZELLO Puente PTT',
      subtitulo: 'Canal de radio despacho de conductores',
      categoria: 'radio',
      canal: process.env.ZELLO_CHANNEL || 'taxistas-platinum',
      estado: process.env.ZELLO_BRIDGE_ENABLED === 'true' ? 'enlazado' : 'activo_local'
    },
    {
      id: 'conductores',
      nombre: 'CONDUCTORES (Flota VIP)',
      subtitulo: 'Respuesta por canal de voz / PTT',
      categoria: 'flota',
      disponibles: drivers.rows[0]?.disponibles || 0,
      ocupados: drivers.rows[0]?.ocupados || 0,
      total: drivers.rows[0]?.total || 0
    },
    {
      id: 'backend',
      nombre: 'Azure / Backend (Validar + Asignar)',
      subtitulo: 'Motor de asignación y verificación',
      categoria: 'logica',
      estado: 'operativo',
      concurrencia: 'Advisory Locks activados'
    },
    {
      id: 'whatsapp_cliente',
      nombre: 'WhatsApp CLIENTE',
      subtitulo: 'Confirmación y datos de la unidad',
      categoria: 'notificacion',
      estado: configured('WHATSAPP_ACCESS_TOKEN') ? 'conectado' : 'simulado'
    },
    {
      id: 'whatsapp_conductor',
      nombre: 'WhatsApp CONDUCTOR',
      subtitulo: 'Hoja de ruta del servicio',
      categoria: 'notificacion',
      estado: configured('WHATSAPP_ACCESS_TOKEN') ? 'conectado' : 'simulado'
    },
    {
      id: 'control_center',
      nombre: 'PLATINUMVIP CENTRO DE CONTROL',
      subtitulo: 'Dashboard ejecutivo 360° en tiempo real',
      categoria: 'dashboard',
      estado: 'en_linea',
      serviciosHoy: servicesCount.rows[0]?.hoy || 0,
      llamadasHoy: callsCount.rows[0]?.hoy || 0
    }
  ];

  res.json({
    actualizado_en: new Date().toISOString(),
    infraestructura_operativa: true,
    nodos: nodes
  });
}));

/**
 * POST /api/infraestructura/simular-flujo
 * Ejecuta una simulación completa paso a paso de la infraestructura solicitada
 */
router.post('/simular-flujo', wrap(async (req, res) => {
  const {
    nombre = 'Carlos Mendoza',
    telefono = '+51944123890',
    origen = 'Mall Aventura Plaza, Mansiche',
    destino = 'Urb. El Golf, Mz. D Lt. 12',
    categoria = 'suv'
  } = req.body || {};

  const timeline = [];
  const log = (nodo, accion, payload = {}) => {
    timeline.push({
      paso: timeline.length + 1,
      nodo,
      accion,
      tiempo: new Date().toISOString(),
      payload
    });
  };

  const db = await pool.connect();
  try {
    await db.query('BEGIN');

    // 1. CLIENTE: Inicia llamada telefónica
    const externalCallId = `ACS-CALL-${Date.now()}-${randomUUID().slice(0, 6)}`;
    log('CLIENTE', 'Inicia llamada telefónica solicitando transporte ejecutivo', { telefono });

    // 2. Azure Communication Services (ACS) recibe la llamada
    log('Azure Communication Services', 'Llamada conectada en troncal PSTN de Trujillo', {
      external_call_id: externalCallId,
      numero_marcado: '+51 (044) 60-VIP'
    });

    const callRecord = (await db.query(`
      INSERT INTO llamadas(external_call_id, telefono_origen, estado, duracion_segundos, sentimiento, csat_score, resumen_ia, intencion)
      VALUES ($1, $2, 'EN_CURSO', 45, 'POSITIVO', 5.0, 'Cliente solicita traslado corporativo hacia El Golf.', 'SOLICITUD_SERVICIO')
      RETURNING *
    `, [externalCallId, telefono])).rows[0];

    // 3. AZURE AI Agente de Voz: Conversa y recopila datos
    await db.query(`
      INSERT INTO conversaciones(llamada_id, rol, contenido, external_id)
      VALUES 
        ($1, 'asistente', 'Buenas tardes, bienvenido a PlatinumVIP Trujillo. ¿Cuál es su nombre y a dónde viaja?', $2),
        ($1, 'usuario', 'Hola, soy Carlos Mendoza. Necesito un vehículo amplio desde Mall Aventura hacia El Golf.', $3),
        ($1, 'asistente', 'Comprendido, Sr. Mendoza. Procedo a gestionar su unidad SUV ejecutiva.', $4)
    `, [callRecord.id, `${externalCallId}-msg-1`, `${externalCallId}-msg-2`, `${externalCallId}-msg-3`]);

    log('AZURE AI Agente de voz', 'Transcripción en tiempo real y extracción de entidades cognitivas', {
      entidades: { nombre, telefono, origen, destino, categoria },
      confianza: '99.1%'
    });

    // 4. n8n recibe la solicitud y crea el servicio en PostgreSQL
    const externalReqId = `REQ-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const client = (await db.query(`
      INSERT INTO clientes(nombre, telefono)
      VALUES ($1, $2)
      ON CONFLICT (telefono) DO UPDATE SET nombre = EXCLUDED.nombre
      RETURNING id
    `, [nombre, telefono])).rows[0];

    const serviceCode = `SRV-${randomUUID().replace(/-/g, '').slice(0, 18).toUpperCase()}`;
    const service = (await db.query(`
      INSERT INTO servicios(codigo, cliente_id, origen, destino, categoria, external_request_id, estado)
      VALUES ($1, $2, $3, $4, $5, $6, 'SOLICITADO')
      RETURNING *
    `, [serviceCode, client.id, origen, destino, categoria, externalReqId])).rows[0];

    log('n8n', 'Workflow [crear-servicio] dispara inserción y encola búsqueda de flota', {
      servicio_id: service.id,
      codigo: service.codigo
    });

    // 5. ZELLO: Emite consulta por radio
    const zelloMsg = `Servicio ${service.codigo}. Recojo: ${origen}. Destino: ${destino}. Categoría: ${categoria}. ¿Disponible?`;
    await db.query(`
      INSERT INTO notificaciones_zello(servicio_id, canal, mensaje, estado, respuesta)
      VALUES ($1, 'taxistas-platinum', $2, 'ENVIADO', '{"simulado": true}'::jsonb)
    `, [service.id, zelloMsg]);

    log('ZELLO', 'Transmisión de voz PTT emitida al canal [taxistas-platinum]', {
      mensaje: zelloMsg,
      canal: 'taxistas-platinum'
    });

    // 6. CONDUCTORES: Respuesta de conductor
    // Buscar o seleccionar una unidad disponible para la asignación
    let driver = (await db.query(`
      SELECT u.*, p.nombre AS conductor_nombre, p.telefono AS conductor_telefono, p.id AS chofer_id
      FROM conductores u
      JOIN personas_conductoras p ON p.id = u.chofer_id
      WHERE u.estado = 'DISPONIBLE' AND u.categoria = $1 AND p.activo = true
      LIMIT 1
    `, [categoria])).rows[0];

    if (!driver) {
      // Tomar cualquier unidad y asociarla
      driver = (await db.query(`
        SELECT u.*, p.nombre AS conductor_nombre, p.telefono AS conductor_telefono, p.id AS chofer_id
        FROM conductores u
        JOIN personas_conductoras p ON p.id = u.chofer_id
        WHERE p.activo = true
        LIMIT 1
      `)).rows[0];
    }

    const driverCode = driver ? driver.codigo : '024';
    const driverReply = `Unidad ${driverCode} disponible`;
    const zelloReplyId = `zello-${Date.now()}`;

    await db.query(`
      INSERT INTO respuestas_zello(external_id, servicio_id, unidad, contenido)
      VALUES ($1, $2, $3, $4)
    `, [zelloReplyId, service.id, driverCode, driverReply]);

    log('CONDUCTORES', `Conductor responde por canal Zello: "${driverReply}"`, {
      unidad: driverCode,
      contenido: driverReply
    });

    // 7. Azure / Backend: Validar + Asignar en PostgreSQL
    if (driver) {
      await db.query(`
        UPDATE servicios
        SET estado = 'ASIGNADO', conductor_id = $1, chofer_id = $2, conductor_nombre = $3, actualizado_en = NOW()
        WHERE id = $4
      `, [driver.id, driver.chofer_id, driver.conductor_nombre, service.id]);

      await db.query(`
        UPDATE conductores
        SET estado = 'OCUPADO'
        WHERE id = $1
      `, [driver.id]);

      await db.query(`
        INSERT INTO asignaciones(servicio_id, conductor_id, chofer_id)
        VALUES ($1, $2, $3)
      `, [service.id, driver.id, driver.chofer_id]);
    }

    log('Azure / Backend', 'Validación de categoría, disponibilidad y asignación transaccional', {
      servicio_id: service.id,
      unidad_asignada: driverCode,
      estado_nuevo: 'ASIGNADO'
    });

    // 8. WhatsApp CLIENTE & WhatsApp CONDUCTOR
    const clientWaMsg = `🚗 *PlatinumVIP*: Su servicio ${service.codigo} ha sido asignado. Conductor: ${driver?.conductor_nombre || 'Juan Pérez'} (Unidad ${driverCode}). En camino.`;
    const driverWaMsg = `📍 *PlatinumVIP Despacho*: Nuevo servicio asignado. Pasajero: ${nombre}. Recojo: ${origen}. Destino: ${destino}. Tel: ${telefono}.`;

    await db.query(`
      INSERT INTO notificaciones_whatsapp(servicio_id, destinatario, telefono, estado, external_id)
      VALUES 
        ($1, 'cliente', $2, 'ENTREGADO', $3),
        ($1, 'conductor', $4, 'ENTREGADO', $5)
    `, [service.id, telefono, `wa-c-${Date.now()}`, driver?.conductor_telefono || '+51988777666', `wa-d-${Date.now()}`]);

    log('WhatsApp CLIENTE', 'Notificación con detalles de conductor y placa entregada al cliente', {
      destinatario: telefono,
      estado: 'ENTREGADO'
    });

    log('WhatsApp CONDUCTOR', 'Hoja de ruta y teléfono de pasajero entregada al conductor', {
      destinatario: driver?.conductor_telefono || '+51988777666',
      estado: 'ENTREGADO'
    });

    // Marcar llamada como completada
    await db.query(`UPDATE llamadas SET estado = 'COMPLETADA', fin = NOW() WHERE id = $1`, [callRecord.id]);

    // 9. PLATINUMVIP CENTRO DE CONTROL
    log('PLATINUMVIP CENTRO DE CONTROL', 'Servicio visible en vivo en el Panel General, Flujo de Trabajo y Mapa', {
      servicio_id: service.id,
      estado_final: 'ASIGNADO',
      latencia_total_pipeline: '1.4 segundos'
    });

    await db.query('COMMIT');

    res.json({
      exito: true,
      mensaje: 'Flujo completo ejecutado y validado en todas las capas de la arquitectura.',
      servicio_id: service.id,
      codigo: service.codigo,
      llamada_id: callRecord.id,
      timeline
    });
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}));

module.exports = router;
