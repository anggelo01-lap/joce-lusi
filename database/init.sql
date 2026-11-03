-- ============================================================================
-- PLATINUMVIP · CENTRO DE CONTROL OPERATIVO
-- PostgreSQL Database Initialization Schema
-- Arquitectura: Microsoft Foundry + Azure ACS + n8n + PostgreSQL + Zello + WhatsApp
-- Trujillo, Perú
-- ============================================================================

-- 1. Clientes / Pasajeros
CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  telefono VARCHAR(30) UNIQUE NOT NULL,
  tipo VARCHAR(30) DEFAULT 'VIP',
  notas TEXT,
  total_viajes INTEGER DEFAULT 0,
  destinos_frecuentes JSONB DEFAULT '[]'::jsonb,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Conductores y Unidades
CREATE TABLE IF NOT EXISTS conductores (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(30) UNIQUE NOT NULL, -- ej: 'Unidad 24'
  nombre VARCHAR(120) NOT NULL,
  telefono VARCHAR(30) NOT NULL,
  placa VARCHAR(20) NOT NULL,
  vehiculo VARCHAR(120) NOT NULL, -- ej: 'Toyota Corolla Blanco 2024'
  categoria VARCHAR(30) NOT NULL DEFAULT 'sedan', -- 'sedan', 'suv', 'van'
  canal_zello VARCHAR(100) DEFAULT 'taxistas-platinum',
  zello_usuario VARCHAR(50),
  estado VARCHAR(30) DEFAULT 'DISPONIBLE', -- 'DISPONIBLE', 'EN_SERVICIO', 'DESCONECTADO', 'MANTENIMIENTO'
  latitud NUMERIC(10,7) DEFAULT -8.1116,
  longitud NUMERIC(10,7) DEFAULT -79.0287,
  ubicacion_en TIMESTAMPTZ DEFAULT NOW(),
  total_servicios INTEGER DEFAULT 0,
  calificacion NUMERIC(3,2) DEFAULT 4.95,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Llamadas telefónicas (Azure Communication Services + Azure AI Voice)
CREATE TABLE IF NOT EXISTS llamadas (
  id SERIAL PRIMARY KEY,
  external_call_id VARCHAR(150) UNIQUE,
  cliente_id INTEGER REFERENCES clientes(id),
  telefono_origen VARCHAR(30) NOT NULL,
  agente_voz VARCHAR(60) DEFAULT 'Azure AI Voice Agent',
  transcripcion TEXT,
  resumen_ia TEXT,
  datos_extraidos JSONB DEFAULT '{}'::jsonb, -- { nombre, telefono, punto_recojo, destino, referencia }
  duracion_segundos INTEGER DEFAULT 0,
  sentimiento VARCHAR(30) DEFAULT 'POSITIVO',
  csat_score NUMERIC(3,1) DEFAULT 5.0,
  estado VARCHAR(40) DEFAULT 'COMPLETADA', -- 'RECIBIDA', 'EN_CURSO', 'COMPLETADA', 'FALLIDA'
  inicio TIMESTAMPTZ DEFAULT NOW(),
  fin TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Conversaciones paso a paso de la llamada
CREATE TABLE IF NOT EXISTS conversaciones (
  id SERIAL PRIMARY KEY,
  llamada_id INTEGER REFERENCES llamadas(id) ON DELETE CASCADE,
  rol VARCHAR(20) NOT NULL, -- 'cliente', 'asistente', 'sistema'
  contenido TEXT NOT NULL,
  external_id VARCHAR(150),
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Solicitudes y Servicios
CREATE TABLE IF NOT EXISTS servicios (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(30) UNIQUE NOT NULL, -- ej: 'SRV-2026-0024'
  cliente_id INTEGER REFERENCES clientes(id),
  conductor_id INTEGER REFERENCES conductores(id),
  llamada_id INTEGER REFERENCES llamadas(id),
  origen TEXT NOT NULL,
  destino TEXT NOT NULL,
  referencia TEXT,
  categoria VARCHAR(40) DEFAULT 'sedan',
  estado VARCHAR(40) DEFAULT 'SOLICITADO', -- 'SOLICITADO', 'EN_ZELLO', 'ASIGNADO', 'EN_RECOJO', 'EN_CURSO', 'COMPLETADO', 'CANCELADO'
  etapa_automatizacion VARCHAR(50) DEFAULT 'SOLICITADO',
  canal_zello VARCHAR(100) DEFAULT 'taxistas-platinum',
  consulta_zello_enviada TIMESTAMPTZ,
  respuesta_conductor_zello TEXT,
  whatsapp_cliente_enviado BOOLEAN DEFAULT FALSE,
  whatsapp_conductor_enviado BOOLEAN DEFAULT FALSE,
  tarifa NUMERIC(10,2) DEFAULT 25.00,
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),
  finalizado_en TIMESTAMPTZ
);

-- 6. Notificaciones y Consultas Zello Radio PTT
CREATE TABLE IF NOT EXISTS notificaciones_zello (
  id SERIAL PRIMARY KEY,
  servicio_id INTEGER REFERENCES servicios(id) ON DELETE CASCADE,
  canal VARCHAR(100) NOT NULL,
  mensaje TEXT NOT NULL,
  estado VARCHAR(30) DEFAULT 'ENVIADO', -- 'PENDIENTE', 'ENVIADO', 'RESPONDIDO', 'EXPIRADO'
  respuesta TEXT,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Respuestas recibidas de conductores por Zello
CREATE TABLE IF NOT EXISTS respuestas_zello (
  id SERIAL PRIMARY KEY,
  external_id VARCHAR(150) UNIQUE,
  servicio_id INTEGER REFERENCES servicios(id) ON DELETE CASCADE,
  unidad VARCHAR(30) NOT NULL,
  conductor_nombre VARCHAR(120),
  contenido TEXT NOT NULL,
  tiempo_respuesta_segundos NUMERIC(5,2) DEFAULT 8.5,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Notificaciones de WhatsApp (Cliente y Conductor)
CREATE TABLE IF NOT EXISTS notificaciones_whatsapp (
  id SERIAL PRIMARY KEY,
  servicio_id INTEGER REFERENCES servicios(id) ON DELETE CASCADE,
  destinatario VARCHAR(20) NOT NULL, -- 'cliente', 'conductor'
  telefono VARCHAR(30) NOT NULL,
  mensaje TEXT NOT NULL,
  estado VARCHAR(30) DEFAULT 'ENTREGADO', -- 'PENDIENTE', 'ENVIADO', 'ENTREGADO', 'LEIDO', 'FALLIDO'
  external_id TEXT,
  error TEXT,
  actualizado_en TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(servicio_id, destinatario)
);

-- 9. Auditoría del Sistema (Audit Log Inmutable)
CREATE TABLE IF NOT EXISTS auditoria_sistema (
  id BIGSERIAL PRIMARY KEY,
  usuario VARCHAR(100) NOT NULL DEFAULT 'Sistema',
  rol VARCHAR(50) DEFAULT 'automatizacion',
  modulo VARCHAR(50) NOT NULL,
  accion VARCHAR(100) NOT NULL,
  detalle TEXT,
  ip VARCHAR(50) DEFAULT '127.0.0.1',
  estado VARCHAR(20) DEFAULT 'OK',
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Configuración del Sistema e Integraciones
CREATE TABLE IF NOT EXISTS configuracion_operativa (
  id INTEGER PRIMARY KEY CHECK (id=1),
  datos JSONB NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Cuentas de Usuarios Administrativos
CREATE TABLE IF NOT EXISTS cuentas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  email VARCHAR(254) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol VARCHAR(20) NOT NULL CHECK(rol IN ('superadmin','admin','operador','supervisor')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Sesiones activas
CREATE TABLE IF NOT EXISTS sesiones (
  token_hash TEXT PRIMARY KEY,
  cuenta_id INTEGER NOT NULL REFERENCES cuentas(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  vence_en TIMESTAMPTZ NOT NULL
);
