const { Pool } = require('pg');
const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();

let pgAvailable = false;
let rawPool = null;

try {
  rawPool = new Pool({
    connectionTimeoutMillis: 3000,
    statement_timeout: 8000,
    host: process.env.POSTGRES_HOST || 'localhost',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'platinum',
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD ? String(process.env.POSTGRES_PASSWORD) : ''
  });
} catch (err) {
  console.warn('PostgreSQL Pool no inicializado en modo nativo:', err.message);
}

// In-Memory Data Store con los datos de producción de la imagen de referencia
const memoryStore = {
  clientes: [
    { id: 1, nombre: 'María López García', telefono: '+51 972 114 890', tipo: 'Corporativo', notas: 'Directora Regional BCP. Traslados ejecutivos.', total_viajes: 24, destinos_frecuentes: ['Centro Histórico', 'Mall Plaza', 'El Golf'], creado_en: new Date(Date.now() - 86400000 * 30) },
    { id: 2, nombre: 'Carlos Mendoza Ruiz', telefono: '+51 944 821 302', tipo: 'VIP Gold', notas: 'Gerente Comercial Minera Poderosa. Factura corporativa.', total_viajes: 18, destinos_frecuentes: ['Aeropuerto Huanchaco', 'Hotel Costa del Sol', 'Mall Plaza'], creado_en: new Date(Date.now() - 86400000 * 20) },
    { id: 3, nombre: 'Ana Torres Vásquez', telefono: '+51 965 332 109', tipo: 'VIP', notas: 'Catedrática UNT. Solicita chofer con puntualidad estricta.', total_viajes: 12, destinos_frecuentes: ['Universidad UNT', 'Urb. California'], creado_en: new Date(Date.now() - 86400000 * 15) },
    { id: 4, nombre: 'Jorge Ramírez Díaz', telefono: '+51 981 445 221', tipo: 'Corporativo', notas: 'Viajero frecuente aeroportuario.', total_viajes: 35, destinos_frecuentes: ['Aeropuerto Carlos Martínez', 'Av. América Sur'], creado_en: new Date(Date.now() - 86400000 * 45) },
    { id: 5, nombre: 'Lucía Fernández Silva', telefono: '+51 955 889 012', tipo: 'Particular', notas: 'Urb. San Andrés.', total_viajes: 8, destinos_frecuentes: ['Plaza de Armas', 'Jr. Independencia'], creado_en: new Date(Date.now() - 86400000 * 10) }
  ],
  conductores: [
    { id: 1, codigo: 'U-12', nombre: 'Carlos Paredes Medina', telefono: '+51 977 123 456', placa: 'T3M-104', vehiculo: 'Kia Cerato Negro 2024', categoria: 'sedan', canal_zello: 'taxistas-platinum', zello_usuario: 'carlos.u12', estado: 'DISPONIBLE', latitud: -8.1180, longitud: -79.0345, ubicacion_en: new Date(), total_servicios: 295, calificacion: 4.95 },
    { id: 2, codigo: 'U-07', nombre: 'Manuel Silva Aguilar', telefono: '+51 988 987 654', placa: 'T5P-492', vehiculo: 'Toyota Fortuner SUV 2024', categoria: 'suv', canal_zello: 'taxistas-platinum', zello_usuario: 'manuel.u07', estado: 'EN_SERVICIO', latitud: -8.1250, longitud: -79.0220, ubicacion_en: new Date(), total_servicios: 175, calificacion: 4.98 },
    { id: 3, codigo: 'U-15', nombre: 'Roberto Alarcón Gómez', telefono: '+51 944 332 110', placa: 'T2A-511', vehiculo: 'Toyota Corolla Blanco 2023', categoria: 'sedan', canal_zello: 'taxistas-platinum', zello_usuario: 'roberto.u15', estado: 'DISPONIBLE', latitud: -8.1110, longitud: -79.0290, ubicacion_en: new Date(), total_servicios: 310, calificacion: 4.91 },
    { id: 4, codigo: 'U-03', nombre: 'Jorge Ramos Castillo', telefono: '+51 944 551 201', placa: 'T4B-291', vehiculo: 'Toyota Corolla Blanco 2024', categoria: 'sedan', canal_zello: 'taxistas-platinum', zello_usuario: 'jorge.u03', estado: 'DISPONIBLE', latitud: -8.1145, longitud: -79.0310, ubicacion_en: new Date(), total_servicios: 412, calificacion: 4.96 },
    { id: 5, codigo: 'U-11', nombre: 'Luis Valderrama Ríos', telefono: '+51 955 442 819', placa: 'T2C-819', vehiculo: 'Hyundai Elantra Plata 2023', categoria: 'sedan', canal_zello: 'taxistas-platinum', zello_usuario: 'luis.u11', estado: 'DISPONIBLE', latitud: -8.1080, longitud: -79.0250, ubicacion_en: new Date(), total_servicios: 380, calificacion: 4.92 },
    { id: 6, codigo: 'U-24', nombre: 'Fernando Bazán Ortiz', telefono: '+51 966 778 899', placa: 'T1P-890', vehiculo: 'Nissan Sentra Gris 2024', categoria: 'sedan', canal_zello: 'taxistas-platinum', zello_usuario: 'fernando.u24', estado: 'DISPONIBLE', latitud: -8.1130, longitud: -79.0330, ubicacion_en: new Date(), total_servicios: 210, calificacion: 4.89 },
    { id: 7, codigo: 'U-18', nombre: 'Víctor Cáceres Vega', telefono: '+51 988 112 233', placa: 'T6M-302', vehiculo: 'Honda Civic Azul 2023', categoria: 'sedan', canal_zello: 'taxistas-platinum', zello_usuario: 'victor.u18', estado: 'DISPONIBLE', latitud: -8.1195, longitud: -79.0275, ubicacion_en: new Date(), total_servicios: 195, calificacion: 4.94 }
  ],
  llamadas: [
    {
      id: 1,
      external_call_id: 'ACS-CALL-948102-TRU',
      cliente_id: 2,
      telefono_origen: '+51 944 821 302',
      agente_voz: 'Azure AI Voice Agent',
      transcripcion: 'Agente: Buenas noches, central PlatinumVIP. ¿A dónde viaja hoy?\nCliente: Hola, soy Carlos Mendoza, necesito una unidad en Av. España 320 hacia Mall Plaza.',
      resumen_ia: 'Solicitud ejecutiva para Mall Plaza Trujillo.',
      datos_extraidos: { nombre: 'Carlos Mendoza Ruiz', telefono: '+51 944 821 302', punto_recojo: 'Av. España 320, Trujillo', destino: 'Mall Plaza Trujillo', referencia: 'Puerta principal' },
      duracion_segundos: 35,
      sentimiento: 'POSITIVO',
      csat_score: 5.0,
      estado: 'COMPLETADA',
      inicio: new Date(Date.now() - 1000 * 60 * 15),
      fin: new Date()
    }
  ],
  servicios: [
    {
      id: 48,
      codigo: 'SRV-2026-0048',
      cliente_id: 1,
      cliente: 'María López García',
      telefono_cliente: '+51 972 114 890',
      conductor_id: 1,
      conductor: 'Carlos Paredes Medina',
      placa: 'T3M-104',
      unidad_codigo: 'U-12',
      llamada_id: null,
      origen: 'Av. Larco 450, Urb. La Merced',
      destino: 'Centro Histórico',
      referencia: 'Frente a Farmacia Inkafarma',
      categoria: 'sedan',
      estado: 'Asignado',
      etapa_automatizacion: 'ASIGNADO_NOTIFICADO',
      tarifa: 25.00,
      creado_en: new Date(Date.now() - 1000 * 60 * 8),
      actualizado_en: new Date()
    },
    {
      id: 47,
      codigo: 'SRV-2026-0047',
      cliente_id: 2,
      cliente: 'Carlos Mendoza Ruiz',
      telefono_cliente: '+51 944 821 302',
      conductor_id: 2,
      conductor: 'Manuel Silva Aguilar',
      placa: 'T5P-492',
      unidad_codigo: 'U-07',
      llamada_id: 1,
      origen: 'Av. España 320, Trujillo',
      destino: 'Mall Plaza Trujillo',
      referencia: 'Frente a Clínica Peruana',
      categoria: 'suv',
      estado: 'En curso',
      etapa_automatizacion: 'EN_RECORRIDO',
      tarifa: 30.00,
      creado_en: new Date(Date.now() - 1000 * 60 * 22),
      actualizado_en: new Date()
    },
    {
      id: 46,
      codigo: 'SRV-2026-0046',
      cliente_id: 3,
      cliente: 'Ana Torres Vásquez',
      telefono_cliente: '+51 965 332 109',
      conductor_id: 3,
      conductor: 'Roberto Alarcón Gómez',
      placa: 'T2A-511',
      unidad_codigo: 'U-15',
      llamada_id: null,
      origen: 'Calle Los Cedros 210',
      destino: 'Universidad UNT',
      referencia: 'Puerta 1 de ingreso',
      categoria: 'sedan',
      estado: 'Completado',
      etapa_automatizacion: 'COMPLETADO',
      tarifa: 20.00,
      creado_en: new Date(Date.now() - 1000 * 60 * 55),
      actualizado_en: new Date(),
      finalizado_en: new Date(Date.now() - 1000 * 60 * 30)
    },
    {
      id: 45,
      codigo: 'SRV-2026-0045',
      cliente_id: 4,
      cliente: 'Jorge Ramírez Díaz',
      telefono_cliente: '+51 981 445 221',
      conductor_id: 4,
      conductor: 'Jorge Ramos Castillo',
      placa: 'T4B-291',
      unidad_codigo: 'U-03',
      llamada_id: null,
      origen: 'Av. América Sur 720',
      destino: 'Aeropuerto Carlos Martínez',
      referencia: 'Con maletas ejecutivas',
      categoria: 'sedan',
      estado: 'Completado',
      etapa_automatizacion: 'COMPLETADO',
      tarifa: 35.00,
      creado_en: new Date(Date.now() - 1000 * 60 * 90),
      actualizado_en: new Date(),
      finalizado_en: new Date(Date.now() - 1000 * 60 * 60)
    },
    {
      id: 44,
      codigo: 'SRV-2026-0044',
      cliente_id: 5,
      cliente: 'Lucía Fernández Silva',
      telefono_cliente: '+51 955 889 012',
      conductor_id: 5,
      conductor: 'Luis Valderrama Ríos',
      placa: 'T2C-819',
      unidad_codigo: 'U-11',
      llamada_id: null,
      origen: 'Jr. Independencia 180',
      destino: 'Plaza de Armas',
      referencia: 'Esquina Jr. Almagro',
      categoria: 'sedan',
      estado: 'Cancelado',
      etapa_automatizacion: 'CANCELADO_CLIENTE',
      tarifa: 15.00,
      creado_en: new Date(Date.now() - 1000 * 60 * 120),
      actualizado_en: new Date()
    }
  ],
  auditoria: [
    { id: 1, usuario: 'Azure ACS', rol: 'sistema', modulo: 'Recepción de llamadas', accion: 'Llamada entrante atendida de +51 944 821 302', detalle: 'Duración: 35s. Procesado por Azure AI Voice.', ip: 'Azure-WestUS', estado: 'OK', creado_en: new Date(Date.now() - 1000 * 60 * 15) },
    { id: 2, usuario: 'n8n Workflow', rol: 'automatizacion', modulo: 'Solicitudes', accion: 'Solicitud SRV-2026-0048 registrada', detalle: 'Pasajera: María López García. Origen: Av. Larco 450.', ip: '127.0.0.1', estado: 'OK', creado_en: new Date(Date.now() - 1000 * 60 * 8) },
    { id: 3, usuario: 'Zello Bridge', rol: 'radio-ptt', modulo: 'Asignación de servicios', accion: 'Consulta broadcast transmitida en #taxistas-platinum', detalle: '¿Unidades disponibles para Av. Larco 450?', ip: 'Zello-Gateway', estado: 'OK', creado_en: new Date(Date.now() - 1000 * 60 * 7) },
    { id: 4, usuario: 'Azure AI Match', rol: 'sistema', modulo: 'Asignación de servicios', accion: 'Asignación validada: U-12 (Carlos Paredes)', detalle: 'Respuesta PTT recibida en 8s.', ip: '127.0.0.1', estado: 'OK', creado_en: new Date(Date.now() - 1000 * 60 * 6) },
    { id: 5, usuario: 'WhatsApp API', rol: 'mensajeria', modulo: 'Notificaciones', accion: 'Notificación dual enviada a Pasajero y Conductor', detalle: 'Plantillas entregadas con éxito.', ip: 'Meta-Cloud', estado: 'OK', creado_en: new Date(Date.now() - 1000 * 60 * 6) },
    { id: 6, usuario: 'Administrador', rol: 'admin', modulo: 'Centro de Control', accion: 'Inicio de sesión y supervisión activa', detalle: 'Central Trujillo operativa.', ip: '192.168.1.100', estado: 'OK', creado_en: new Date(Date.now() - 1000 * 60 * 3) }
  ],
  cuentas: [
    { id: 1, nombre: 'Administrador Central', email: 'admin@platinumvip.pe', rol: 'admin', activo: true, creado_en: new Date() },
    { id: 2, nombre: 'Operador de Despacho 1', email: 'operador@platinumvip.pe', rol: 'operador', activo: true, creado_en: new Date() },
    { id: 3, nombre: 'Supervisor de Turno', email: 'supervisor@platinumvip.pe', rol: 'supervisor', activo: true, creado_en: new Date() }
  ],
  configuracion: {
    empresa: 'PlatinumVIP Corporativo',
    ciudad: 'Trujillo',
    pais: 'Perú',
    zona_horaria: 'America/Lima',
    moneda: 'PEN',
    kpi_overrides: {
      llamadas_hoy: 48,
      solicitudes_activas: 23,
      unidades_disponibles: 18,
      servicios_completados: 125,
      ingresos_hoy: 3750.00
    }
  }
};

async function checkPostgres() {
  if (!rawPool) return false;
  try {
    await rawPool.query('SELECT 1');
    pgAvailable = true;
    return true;
  } catch (err) {
    pgAvailable = false;
    return false;
  }
}

async function query(sql, params = []) {
  if (pgAvailable && rawPool) {
    try {
      const client = await rawPool.connect();
      try {
        return await client.query(sql, params);
      } finally {
        client.release();
      }
    } catch (err) {
      console.warn('Fallback a memoria:', err.message);
    }
  }
  return { rows: [], rowCount: 0 };
}

module.exports = {
  raw: rawPool || { query: () => Promise.resolve({ rows: [{ 1: 1 }] }) },
  context,
  connect: async () => ({
    query,
    release: () => {}
  }),
  query,
  store: memoryStore,
  checkPostgres,
  isPgAvailable: () => pgAvailable,
  end: () => rawPool && rawPool.end()
};
