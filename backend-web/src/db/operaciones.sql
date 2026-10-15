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
