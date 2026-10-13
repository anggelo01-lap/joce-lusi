CREATE TABLE IF NOT EXISTS clientes (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120),
  telefono VARCHAR(30) UNIQUE NOT NULL,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conductores (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(30) UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  telefono VARCHAR(30),
  placa VARCHAR(20),
  vehiculo VARCHAR(120),
  categoria VARCHAR(30),
  estado VARCHAR(30) DEFAULT 'DISPONIBLE',
  latitud NUMERIC(10,7),
  longitud NUMERIC(10,7),
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS llamadas (
  id SERIAL PRIMARY KEY,
  cliente_id INTEGER REFERENCES clientes(id),
  twilio_call_sid VARCHAR(100) UNIQUE,
  telefono_origen VARCHAR(30),
  transcripcion TEXT,
  estado VARCHAR(40) DEFAULT 'RECIBIDA',
  inicio TIMESTAMPTZ DEFAULT NOW(),
  fin TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS servicios (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(30) UNIQUE,
  cliente_id INTEGER REFERENCES clientes(id),
  conductor_id INTEGER REFERENCES conductores(id),
  llamada_id INTEGER REFERENCES llamadas(id),
  origen TEXT,
  destino TEXT,
  categoria VARCHAR(40),
  estado VARCHAR(40) DEFAULT 'SOLICITADO',
  tarifa NUMERIC(10,2),
  creado_en TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversaciones (
  id SERIAL PRIMARY KEY,
  llamada_id INTEGER REFERENCES llamadas(id) ON DELETE CASCADE,
  rol VARCHAR(20) NOT NULL,
  contenido TEXT NOT NULL,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notificaciones_zello (
  id SERIAL PRIMARY KEY,
  servicio_id INTEGER REFERENCES servicios(id) ON DELETE CASCADE,
  canal VARCHAR(100),
  mensaje TEXT NOT NULL,
  estado VARCHAR(30) DEFAULT 'PENDIENTE',
  respuesta TEXT,
  creado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Las unidades se registran desde el dashboard. No insertar datos de demostración.
