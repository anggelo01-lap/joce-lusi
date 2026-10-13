# Operadora IA Platinum — integración de los 2 ZIP

Esta versión conserva:
- El frontend real de `Reception_Platinium-jose-luis`.
- El ORIÓN original en `asistente-voz/legacy/orion_desktop.py`.

Y añade:
- PostgreSQL 17.
- Backend Node.js/Express.
- API REST de conductores y servicios.
- Webhooks base para Twilio Voice.
- Microservicio ORIÓN con FastAPI.
- Endpoint ElevenLabs para convertir texto a voz.
- Adaptador de Zello pendiente de configurar con un endpoint/API autorizado.
- Docker Compose.

## 1. Configurar
Crea `.env` a partir del ejemplo (PowerShell):

```powershell
Copy-Item .env.example .env
```

Si ya tienes `.env`, edítalo sin sobrescribirlo. Cambia `POSTGRES_PASSWORD` por una contraseña segura y coloca las credenciales de las integraciones que utilizarás. Nunca subas `.env` a GitHub.

## 2. Ejecutar
```bash
docker compose up --build
```

## 3. Abrir
- Web: http://localhost:5000
- Dashboard: http://localhost:5000/dashboard
- Backend health: http://localhost:5000/api/health
- API de operaciones (Swagger UI): http://localhost:5000/api/docs
- ORIÓN: http://localhost:8000
- ORIÓN docs: http://localhost:8000/docs

## 4. Twilio
Para llamadas reales, Twilio debe poder acceder públicamente a:
`POST <PUBLIC_BASE_URL>/api/twilio/voice`

En desarrollo local necesitarás exponer el puerto 5000 mediante un túnel HTTPS o desplegar el backend en un servidor público.

## 5. ElevenLabs
Configura:
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`

Prueba desde la documentación de ORIÓN:
`POST /api/speak`

## 6. Zello
No se inventó una API de Zello. El proyecto incluye un adaptador genérico desactivado hasta que definas:
- `ZELLO_API_URL`
- `ZELLO_API_TOKEN`
- `ZELLO_CHANNEL`

## Dashboard operativo de Trujillo
El frontend consulta PostgreSQL para mostrar servicios, unidades, llamadas e indicadores. Incluye asignación de unidades, estados de servicio, configuración persistente y mapa con historial de puntos manuales o recibidos por API. No simula recorridos ni conexiones.

Consulta [la guía de operación y API de ubicación](docs/operacion-dashboard.md). Las tablas nuevas se aplican al iniciar el backend sin borrar el volumen existente.

## Acceso, roles y empresas

La aplicación requiere iniciar sesión. En la primera apertura de http://localhost:5000, registra las **dos cuentas de los programadores**, cada una con su correo y una contraseña de al menos 12 caracteres. Copia el código de instalación del valor `ADMIN_SETUP_TOKEN` de tu `.env`. El registro inicial se cierra después de crear esas dos cuentas; no hay contraseñas predeterminadas.

Para una instalación nueva, reemplaza el código de ejemplo por un valor aleatorio de al menos 32 caracteres. En PowerShell puedes generar uno con `[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')` y copiar el resultado a `ADMIN_SETUP_TOKEN`.

- **Superadministrador:** los dos programadores gestionan todas las empresas. En Configuraciones pueden crear una empresa, abrir su central y registrar al dueño con el rol Administrador.
- **Administrador:** el dueño administra la configuración y operación de su empresa y crea, activa o desactiva cuentas de trabajadores. No puede crear superadministradores ni acceder a otra empresa.
- **Usuario:** el trabajador gestiona servicios, unidades y recorridos de su empresa y consulta la configuración. No puede modificarla ni administrar cuentas o empresas.

Si ya existe una cuenta de superadministrador, el segundo programador puede registrarse desde **Configuraciones → Cuentas y permisos**, seleccionando **Superadministrador**. La plataforma admite como máximo dos cuentas con ese rol. Estas cuentas tienen acceso a todas las empresas; las cuentas de administrador y usuario pertenecen a la empresa activa.

Cada empresa tiene sus propias tablas operativas en un esquema de PostgreSQL. Los datos actuales permanecen en la empresa original. Las empresas nuevas comienzan vacías. El cambio de empresa afecta solo a la sesión del superadministrador que lo realiza.

Desde Configuraciones cada persona puede cambiar su contraseña. El administrador puede restablecer la de un trabajador; el superadministrador también puede restablecer la de un dueño. Desactivar una cuenta o editar su acceso cierra sus sesiones. La empresa debe conservar al menos un administrador activo.

Swagger del backend utiliza la sesión de la web y añade el token CSRF al ejecutar “Try it out”. Los webhooks Twilio requieren firma válida y se asignan a la empresa original. Las credenciales externas de `.env` siguen siendo de esta instalación: Zello está desactivado para las empresas nuevas hasta disponer de configuración por empresa. Orión y ElevenLabs continúan como servicios compartidos de la instalación; su documentación en el puerto 8000 conserva su acceso independiente.

Para publicar la instalación, sirve la web mediante HTTPS y usa `COOKIE_SECURE=true` (en localhost HTTP, mantenlo en `false`). La zona horaria y los demás valores operativos siguen usando Trujillo, Perú; el alta de empresas en esta versión separa datos y cuentas, pero no configura nuevos dominios ni despliegues independientes.

Pruebas en bases temporales, sin alterar la operación:

```powershell
docker compose exec -T backend node tests/acceso.integration.js
docker compose exec -T backend node tests/operaciones.integration.js
```

El superadministrador puede editar nombres de empresas y eliminar empresas vacías (excepto la original y la activa). En Cuentas y permisos puede editar nombre, correo, rol y contraseña, activar, desactivar y eliminar cuentas de la empresa activa. Se conserva el último administrador activo; las cuentas de superadministrador mantienen su protección. Las eliminaciones requieren confirmación en la pantalla.
