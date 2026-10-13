ALTER TABLE conductores ADD COLUMN IF NOT EXISTS ubicacion_en TIMESTAMPTZ;
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
