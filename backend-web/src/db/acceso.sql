CREATE TABLE IF NOT EXISTS public.empresas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  esquema VARCHAR(60) UNIQUE NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.empresas(nombre,esquema)
SELECT datos->>'empresa','public' FROM public.configuracion_operativa WHERE id=1
ON CONFLICT(esquema) DO NOTHING;
CREATE TABLE IF NOT EXISTS public.cuentas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  email VARCHAR(254) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol VARCHAR(20) NOT NULL CHECK(rol IN ('superadmin','admin','usuario')),
  empresa_id INTEGER REFERENCES public.empresas(id),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((rol='superadmin' AND empresa_id IS NULL) OR (rol<>'superadmin' AND empresa_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS public.sesiones (
  token_hash TEXT PRIMARY KEY,
  cuenta_id INTEGER NOT NULL REFERENCES public.cuentas(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES public.empresas(id),
  csrf TEXT NOT NULL,
  vence_en TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sesiones_cuenta ON public.sesiones(cuenta_id);
CREATE TABLE IF NOT EXISTS public.intentos_acceso (
  clave TEXT PRIMARY KEY,
  intentos INTEGER NOT NULL DEFAULT 0,
  desde TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
