# Central PlatinumVIP — Trujillo

El frontend usa PostgreSQL a través del backend. No genera viajes, ingresos, llamadas ni posiciones simuladas. Los datos antiguos se conservan. Las instalaciones nuevas empiezan sin conductores de ejemplo; en un volumen existente podrían seguir presentes los tres conductores de demostración del esquema anterior.

## Iniciar

Desde la raíz del proyecto:

```powershell
docker compose up -d --build backend
```

Abrir http://localhost:5000/dashboard. El backend aplica `backend-web/src/db/operaciones.sql` al arrancar, incluso si el volumen de PostgreSQL ya existe. No es necesario borrar el volumen ni reinicializarlo.

## Operación

1. En **Unidades y conductores**, registrar el vehículo en **Unidades**, crear la persona en **Conductores** y usar **Asignar conductor**.
2. En **Nuevo servicio**, registrar cliente, teléfono, origen, destino y categoría.
3. En **Despacho** o **Flujo de trabajo**, usar **Gestionar** para asignar una unidad disponible de la misma categoría.
4. Avanzar por `SOLICITADO → ASIGNADO → EN_RECOJO → EN_CURSO → COMPLETADO`. Se puede cancelar un servicio activo. Registrar la tarifa acordada; no se calcula una tarifa automática.
5. Al completar o cancelar, la unidad vuelve a estar disponible si no tiene otro servicio activo.

Los indicadores cuentan todos los servicios de la base. Las listas y el flujo muestran los últimos 100. La facturación de hoy suma tarifas de servicios finalizados hoy; cambiar una tarifa después no modifica la fecha de finalización. Para los registros completados antes de esta actualización se conserva su última fecha de actualización como fecha histórica de finalización. No representa cobros confirmados: no hay tabla de pagos en esta versión.

## Gestión de unidades y conductores

El módulo tiene dos pestañas con CRUD independientes: **Unidades** (código, placa, vehículo y categoría) y **Conductores** (código, nombre, teléfono, licencia y estado activo/inactivo). La búsqueda de unidades también permite localizar a su conductor actual.

En la tarjeta de una unidad, **Asignar conductor** permite seleccionar una persona activa o **Sin conductor**. Cada conductor puede estar asignado a una sola unidad. Para cambiarlo de vehículo, primero se desasigna de la unidad anterior. Las unidades nuevas pueden registrarse sin conductor, pero no pueden despacharse hasta tener uno activo. No se permite cambiar el conductor ni editar sus datos durante un servicio activo.

Al asignar una unidad a un servicio se guarda el conductor y su nombre en ese momento. Cambiar de conductor o editar su nombre después no modifica los servicios anteriores. Las ubicaciones siguen perteneciendo al vehículo. El rendimiento de unidades se identifica por código y placa.

Solo se pueden eliminar unidades sin servicios ni ubicaciones, y conductores sin unidad asignada ni servicios. Para retirar un conductor con historial, desasígnalo y marca su estado como **Inactivo**.

La migración inicial conserva las unidades y crea registros independientes para los conductores existentes, con códigos `MIG-ID`. Importa a los servicios anteriores la asociación disponible al migrar; no puede reconstruir cambios de turno que nunca fueron registrados. Los registros con nombres iguales no se fusionan automáticamente. Reiniciar el backend no vuelve a importar conductores ni repone asignaciones retiradas.

La API ofrece CRUD en `/api/unidades` y `/api/personal-conductores` (GET/POST en la colección, GET/PUT/DELETE por ID). `PUT /api/unidades/{id}/conductor` recibe `{"chofer_id": ID}` o `{"chofer_id": null}` para desasignar. Las rutas antiguas `/api/conductores` siguen como alias de unidades, marcadas como obsoletas en Swagger; sus campos de nombre y teléfono ya no actualizan personas. `servicios.conductor_id` conserva el identificador de la unidad por compatibilidad; `chofer_id` identifica a la persona. Los endpoints usan la sesión y empresa activa y las modificaciones requieren CSRF.

## Ubicación manual y futura integración GPS

En **Despacho y recorridos**, registrar coordenadas verificadas con **Registrar ubicación manual**. Se pueden asociar a un servicio de esa unidad y a una fecha histórica. El formulario interpreta la hora como hora de Perú (UTC−05).

La API acepta un punto por solicitud:

```http
POST /api/conductores/ID_UNIDAD/posiciones
Content-Type: application/json

{
  "latitud": -8.1116,
  "longitud": -79.0287,
  "fuente": "gps",
  "registrado_en": "2026-10-12T10:30:00-05:00"
}
```

Reemplazar ID_UNIDAD, coordenadas y fecha por datos reales. `fuente` puede ser `manual`, `gps` o `movil`. `registrado_en` es opcional (por defecto, ahora), debe incluir zona horaria y no puede estar en el futuro. `servicio_id` es opcional y debe pertenecer a la unidad.

Consultar un día en Perú:

```http
GET /api/conductores/ID_UNIDAD/recorrido?fecha=2026-10-12
GET /api/conductores/ID_UNIDAD/recorrido?fecha=2026-10-12&servicio_id=ID_SERVICIO
```

Los puntos se ordenan por fecha e identificador. Se devuelven como máximo 20 000 por consulta, con `truncado` si hay más. Un punto histórico no reemplaza una ubicación más reciente. El mapa solo muestra posiciones cuya fecha se conoce; gris significa ubicación de más de cinco minutos. No hay proveedor GPS conectado ni captura automática desde celulares todavía.

Las líneas conectan puntos registrados y la distancia suma segmentos geográficos aproximados. No es navegación por calles ni kilometraje certificado; los huecos entre mediciones pueden subestimar el recorrido. El historial se puede exportar a GeoJSON, incluso si el mapa no carga. El mapa usa Leaflet 1.9.4 y OpenStreetMap y requiere internet para los mosaicos.

## Integraciones y acceso

**Conexiones** prueba PostgreSQL y `/health` de Orión. Twilio, ElevenLabs y Zello muestran únicamente si tienen credenciales configuradas; esto no prueba su funcionamiento externo. Orión actualmente es un asistente de reglas y no realiza despacho automático. Los fallos del aviso Zello no impiden guardar un servicio.

**Configuraciones** guarda nombre de empresa e intervalo de actualización (15–300 segundos). Ciudad, moneda y zona horaria están fijadas a Trujillo, PEN y America/Lima.

El acceso requiere una cuenta y contraseña. Los superadministradores gestionan las empresas; los administradores gestionan su empresa y sus trabajadores; los usuarios operan servicios, unidades y recorridos. El backend verifica estos permisos y selecciona las tablas de la empresa de la sesión. Las escrituras requieren el token CSRF de la sesión; Swagger lo añade automáticamente. Consulta el [registro inicial y la gestión de cuentas](../README.md#Acceso-roles-y-empresas).

## Verificación aislada

`backend-web/tests/operaciones.integration.js` se ejecuta dentro del contenedor y crea una base temporal `platinum_test_*`, que elimina al terminar. Requiere permisos de creación de bases y copia de `database/init.sql` a `/tmp/platinum-init.sql`. No modifica los registros operativos ni llama a Zello.

```powershell
docker compose cp database/init.sql backend:/tmp/platinum-init.sql
docker compose cp backend-web/tests/operaciones.integration.js backend:/tmp/operaciones.integration.js
docker compose exec -T backend node /tmp/operaciones.integration.js
```

## Mejoras de interacción (panel, flujo y consola)

**Panel general:** franja de alertas accionables (pedidos sin unidad > 5 min, sin unidades libres, completados sin tarifa), tarjetas KPI clicables, gráfico de la semana, servicios por estado (clic para filtrar), rendimiento de 30 días y unidades destacadas. Nuevo endpoint `GET /api/estadisticas`; `GET /api/resumen` añade `esperando_mucho`, `cancelados_hoy` y `completados_hoy`.

**Flujo de trabajo:** tablero de 6 fases con arrastrar y soltar (solo permite transiciones válidas), asignación de unidad directa en la tarjeta, botón de siguiente paso, cancelar con confirmación, cronómetro de espera, búsqueda y filtro por categoría. Al completar sin tarifa se abre el diálogo para registrarla.

**Consola Orión:** Orión extrae recojo, destino, categoría, teléfono y nombre y los muestra en una ficha editable; el servicio solo se crea al pulsar *Registrar servicio*. Respuestas rápidas, dictado por micrófono (si el navegador lo soporta), voz ElevenLabs con `POST /api/orion/voz` y historial de llamadas con conversación y acción *Crear servicio*. Nuevo `GET /api/llamadas/:id/conversacion`.

Archivos nuevos: `frontend/mejoras.js` y `frontend/mejoras.css`.
