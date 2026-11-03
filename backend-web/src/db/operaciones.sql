ALTER TABLE conductores ADD COLUMN IF NOT EXISTS ubicacion_en TIMESTAMPTZ;
ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS datos JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS finalizado_en TIMESTAMPTZ;
UPDATE servicios SET finalizado_en=actualizado_en WHERE estado='COMPLETADO' AND finalizado_en IS NULL;
CREATE TABLE IF NOT EXISTS posiciones_unidad (
  id BIGSERIAL PRIMARY KEY,
  conductor_id INTEGER NOT NULL REFERENCES conductores(id),
  servicio_id INTEGER REFERENCES servicios(id),
  latitud NUMERIC(10,7) NOT NULL CHECK (latitud BETWEEN -90 AND 90),
  longitud NUMERIC(10,7) NOT NULL CHECK (longitud BETWEEN -180 AND 180),
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fuente VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (fuente IN ('manual','gps','movil'))
);
CREATE INDEX IF NOT EXISTS posiciones_unidad_fecha ON posiciones_unidad(conductor_id, registrado_en, id);
CREATE TABLE IF NOT EXISTS configuracion_operativa (
  id INTEGER PRIMARY KEY CHECK (id=1),
  datos JSONB NOT NULL,
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO configuracion_operativa(id, datos) VALUES (1,
  '{"empresa":"PlatinumVIP","ciudad":"Trujillo","pais":"Perú","zona_horaria":"America/Lima","moneda":"PEN","latitud":-8.1116,"longitud":-79.0287,"intervalo_segundos":30}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Physical units retain the legacy table name; people have independent records.
CREATE TABLE IF NOT EXISTS personas_conductoras (
  id SERIAL PRIMARY KEY,
  codigo VARCHAR(30) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  telefono VARCHAR(30) NOT NULL DEFAULT '',
  licencia VARCHAR(40) NOT NULL DEFAULT '',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='conductores' AND column_name='chofer_id') THEN
    ALTER TABLE conductores ADD COLUMN chofer_id INTEGER UNIQUE REFERENCES personas_conductoras(id);
    ALTER TABLE servicios ADD COLUMN chofer_id INTEGER REFERENCES personas_conductoras(id);
    ALTER TABLE servicios ADD COLUMN conductor_nombre VARCHAR(120);
    -- Import once. Equal names do not prove two existing records are the same person.
    INSERT INTO personas_conductoras(codigo,nombre,telefono)
      SELECT 'MIG-' || id,nombre,COALESCE(telefono,'') FROM conductores WHERE trim(nombre)<>'';
    UPDATE conductores u SET chofer_id=p.id FROM personas_conductoras p WHERE p.codigo='MIG-' || u.id;
    UPDATE servicios s SET chofer_id=u.chofer_id,conductor_nombre=u.nombre FROM conductores u WHERE s.conductor_id=u.id;
  END IF;
END $$;

-- Idempotent migration, run under the current company's search_path.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='llamadas' AND column_name='twilio_call_sid')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='llamadas' AND column_name='external_call_id') THEN
    ALTER TABLE llamadas RENAME COLUMN twilio_call_sid TO external_call_id;
  END IF;
END $$;
ALTER TABLE llamadas ALTER COLUMN external_call_id TYPE VARCHAR(150);
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS external_request_id VARCHAR(150) UNIQUE;
ALTER TABLE servicios ADD COLUMN IF NOT EXISTS etapa_automatizacion VARCHAR(40) NOT NULL DEFAULT 'SOLICITADO';
CREATE TABLE IF NOT EXISTS eventos_servicio (
  id BIGSERIAL PRIMARY KEY, servicio_id INTEGER NOT NULL REFERENCES servicios(id),
  tipo VARCHAR(60) NOT NULL, datos JSONB NOT NULL DEFAULT '{}', creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS asignaciones (
  id BIGSERIAL PRIMARY KEY, servicio_id INTEGER NOT NULL REFERENCES servicios(id),
  conductor_id INTEGER NOT NULL REFERENCES conductores(id), chofer_id INTEGER REFERENCES personas_conductoras(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS respuestas_zello (
  id BIGSERIAL PRIMARY KEY, external_id VARCHAR(150) NOT NULL UNIQUE,
  servicio_id INTEGER NOT NULL REFERENCES servicios(id), unidad VARCHAR(30) NOT NULL,
  contenido TEXT NOT NULL, creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notificaciones_whatsapp (
  id BIGSERIAL PRIMARY KEY, servicio_id INTEGER NOT NULL REFERENCES servicios(id),
  destinatario VARCHAR(20) NOT NULL CHECK (destinatario IN ('cliente','conductor')),
  telefono VARCHAR(30) NOT NULL, estado VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
  external_id TEXT UNIQUE, error TEXT, actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(servicio_id,destinatario)
);
CREATE TABLE IF NOT EXISTS automatizaciones (
  id BIGSERIAL PRIMARY KEY, servicio_id INTEGER NOT NULL REFERENCES servicios(id),
  tipo VARCHAR(60) NOT NULL, estado VARCHAR(30) NOT NULL DEFAULT 'PENDIENTE',
  respuesta JSONB, creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(servicio_id,tipo)
);
CREATE OR REPLACE FUNCTION auditar_despacho() RETURNS trigger AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO eventos_servicio(servicio_id,tipo) VALUES(NEW.id,'SOLICITADO');
    INSERT INTO automatizaciones(servicio_id,tipo) VALUES(NEW.id,'buscar-unidad') ON CONFLICT DO NOTHING;
  ELSE
    IF NEW.estado IS DISTINCT FROM OLD.estado THEN
      INSERT INTO eventos_servicio(servicio_id,tipo) VALUES(NEW.id,NEW.estado);
    END IF;
    IF NEW.conductor_id IS DISTINCT FROM OLD.conductor_id AND NEW.conductor_id IS NOT NULL THEN
      INSERT INTO asignaciones(servicio_id,conductor_id,chofer_id) VALUES(NEW.id,NEW.conductor_id,NEW.chofer_id);
      INSERT INTO automatizaciones(servicio_id,tipo) VALUES(NEW.id,'notificar-whatsapp') ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS auditar_despacho ON servicios;
CREATE TRIGGER auditar_despacho AFTER INSERT OR UPDATE ON servicios FOR EACH ROW EXECUTE FUNCTION auditar_despacho();
CREATE INDEX IF NOT EXISTS eventos_servicio_timeline ON eventos_servicio(servicio_id,id);

ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS external_id VARCHAR(150);
CREATE UNIQUE INDEX IF NOT EXISTS conversaciones_external ON conversaciones(llamada_id,external_id);

-- Enriquecimiento para Azure AI, métricas y análisis de datos
ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS duracion_segundos INTEGER DEFAULT 0;
ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS sentimiento VARCHAR(30) DEFAULT 'NEUTRAL';
ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS csat_score NUMERIC(3,1) DEFAULT 4.8;
ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS resumen_ia TEXT;
ALTER TABLE llamadas ADD COLUMN IF NOT EXISTS intencion VARCHAR(60) DEFAULT 'SOLICITUD_SERVICIO';

CREATE TABLE IF NOT EXISTS analisis_azure (
  id BIGSERIAL PRIMARY KEY,
  tipo VARCHAR(60) NOT NULL,
  periodo VARCHAR(30) NOT NULL DEFAULT 'hoy',
  resumen_ejecutivo TEXT,
  metricas JSONB NOT NULL DEFAULT '{}',
  prediccion_demanda JSONB NOT NULL DEFAULT '[]',
  zonas_calor JSONB NOT NULL DEFAULT '[]',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS analisis_azure_tipo_periodo ON analisis_azure(tipo, periodo, actualizado_en DESC);

