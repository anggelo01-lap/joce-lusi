const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const pool = require('./db/pool');

const api = require('./routes/api');
const twilioRoutes = require('./routes/twilio');
const swaggerUi = require('swagger-ui-express');
const openapi = require('./openapi');
const app = express();

app.disable('x-powered-by');
app.use(express.json({limit:'32kb'}));
app.use(express.urlencoded({extended:false}));

const acceso = require('./acceso');
app.use('/api/acceso', acceso.router);
app.get('/api/health', async (_req,res) => {
  try { await pool.raw.query('SELECT 1'); res.json({ok:true,database:true}); }
  catch { res.status(503).json({ok:false,database:false}); }
});
app.use('/api/twilio', (req,res,next) => {
  const twilio = require('twilio');
  const token=process.env.TWILIO_AUTH_TOKEN;
  if(!token || !process.env.PUBLIC_BASE_URL || !twilio.validateRequest(token,req.headers['x-twilio-signature'] || '',`${process.env.PUBLIC_BASE_URL}${req.originalUrl}`,req.body))
    return res.status(403).json({error:'Webhook no autorizado.'});
  // These instance-level credentials belong to the original company only.
  pool.context.run({schema:'public'},next);
}, twilioRoutes);
app.use('/api', acceso.authenticate);
app.get('/api/openapi.json', (_req,res) => res.json(openapi));
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'API de operaciones — PlatinumVIP', swaggerOptions: {
  docExpansion: 'list', tryItOutEnabled: true,
  requestInterceptor: async function(request) {
    if(!['GET','HEAD','OPTIONS'].includes(request.method.toUpperCase())) {
      const response=await fetch('/api/acceso/yo',{credentials:'same-origin'});
      if(response.ok)request.headers['X-CSRF-Token']=(await response.json()).csrf;
    }
    return request;
  }
} }));
app.use('/api', require('./routes/operaciones'));
app.use('/api', api);
app.use('/api', (_req,res) => res.status(404).json({error:'Endpoint no encontrado.'}));
app.use((error, _req, res, _next) => {
  console.error('API:', error.message);
  const status = error.status || (error.code === '23505' ? 409 : 500);
  res.status(status).json({error: status < 500 ? (error.code === '23505' ? 'Ese correo o código ya está registrado.' : error.message) : 'No se pudo completar la operación. Revisa la configuración y los registros del servidor.'});
});

const frontend = path.resolve(__dirname, '../../frontend');
app.get(['/dashboard','/dashboard.html'], (req,res) => acceso.authenticate(req,res,error=>{
  if(error) {
    if(error.status===401)return res.redirect('/');
    return res.status(error.status || 500).send('No se pudo abrir el dashboard.');
  }
  res.sendFile(path.join(frontend,'dashboard.html'));
}));
app.use(express.static(frontend));
app.get('*', (_req,res) => res.sendFile(path.join(frontend,'index.html')));

const port = Number(process.env.PORT || 5000);
async function start() {
  await pool.query(fs.readFileSync(path.join(__dirname,'db/operaciones.sql'),'utf8'));
  await pool.raw.query(fs.readFileSync(path.join(__dirname,'db/acceso.sql'),'utf8'));
  const companies=await pool.raw.query("SELECT esquema FROM public.empresas WHERE esquema<>'public'");
  for(const company of companies.rows) await pool.context.run({schema:company.esquema},()=>pool.query(fs.readFileSync(path.join(__dirname,'db/operaciones.sql'),'utf8')));
  app.listen(port, '0.0.0.0', () => console.log(`Platinum backend: http://localhost:${port}`));
}
start().catch(error => { console.error('No se pudo preparar la base de datos:',error.message); process.exit(1); });
