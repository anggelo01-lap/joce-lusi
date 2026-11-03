# PlatinumVIP — Operadora IA

Centro de control con Express, PostgreSQL, n8n y adaptadores para Azure AI, un puente autorizado de Zello y WhatsApp Business Cloud API. Conserva acceso por empresa, flota, despacho, llamadas y recorridos.

Orión, Twilio y ElevenLabs fueron retirados, incluidas las copias temporales de migración.

Para instalar, configura `.env` según `.env.example`. Conserva las credenciales y el nombre de la base existente. Genera claves independientes para `N8N_ENCRYPTION_KEY`, `N8N_WEBHOOK_TOKEN` e `INTEGRATION_API_TOKEN`; el archivo local de esta migración ya tiene esos valores.

```powershell
docker compose up -d --build
```

Dashboard: http://localhost:5000/dashboard. Editor n8n: http://localhost:5678. API: http://localhost:5000/api/docs. El backend migra cada esquema al iniciar; no borres el volumen PostgreSQL.

Importa los cuatro JSON de `n8n/workflows/`, configura sus credenciales y publica los workflows. Activa `AUTOMATION_WORKER_ENABLED=true` cuando los proveedores estén listos y recrea el backend. También puedes procesar la cola desde Operadora IA con una cuenta administradora.

Azure dispone de interpretación de texto y registro de llamadas; el agente de voz ACS debe desplegarse externamente. Zello queda desactivado hasta confirmar edición y API autorizada. WhatsApp requiere cuenta, números y plantilla aprobada por Meta. Las pruebas de extremo a extremo usan proveedores simulados.

Consulta [contratos, activación, limitaciones y pruebas](docs/arquitectura.md).
