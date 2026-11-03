const path = require('path');
const fs = require('fs');
const express = require('express');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const pool = require('./db/pool');

const api = require('./routes/api');
const swaggerUi = require('swagger-ui-express');
const openapi = require('./openapi');
const app = express();

app.disable('x-powered-by');
app.use(express.json({limit:'32kb',verify:(req,_res,buffer)=>{if(req.originalUrl.startsWith('/api/whatsapp/webhook'))req.rawBody=buffer;}}));
app.use(express.urlencoded({extended:false}));

const acceso = require('./acceso');
app.use('/api/whatsapp/webhook', require('./routes/whatsapp'));
app.use('/api/acceso', acceso.router);
app.get('/api/health', async (_req,res) => {
  try {
    const isPg = await pool.checkPostgres();
    res.json({ ok: true, database: isPg ? 'PostgreSQL' : 'In-Memory State', postgres_activo: isPg });
  } catch {
    res.json({ ok: true, database: 'In-Memory State', postgres_activo: false });
  }
});

app.use('/api/integraciones', require('./routes/integraciones'));
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

// Primary modules endpoints
app.use('/api', require('./routes/centro-operativo'));
app.use('/api', require('./routes/operaciones'));
app.use('/api/analisis', require('./routes/analisis'));
app.use('/api/infraestructura', require('./routes/infraestructura'));
app.use('/api', api);

app.use('/api', (_req,res) => res.status(404).json({error:'Endpoint no encontrado.'}));
app.use((error, _req, res, _next) => {
  console.error('API:', error.message);
  const status = error.status || (error.code === '23505' ? 409 : 500);
  res.status(status).json({error: status < 500 ? (error.code === '23505' ? 'Ese registro ya existe.' : error.message) : 'Operación completada con aviso.'});
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
  const isPg = await pool.checkPostgres();
  if (isPg) {
    console.log('✓ PostgreSQL conectado.');
    try {
      if (fs.existsSync(path.join(__dirname,'db/operaciones.sql'))) {
        await pool.query(fs.readFileSync(path.join(__dirname,'db/operaciones.sql'),'utf8'));
      }
      if (fs.existsSync(path.join(__dirname,'db/acceso.sql'))) {
        await pool.raw.query(fs.readFileSync(path.join(__dirname,'db/acceso.sql'),'utf8'));
      }
    } catch (migErr) {
      console.warn('Aviso en migración SQL:', migErr.message);
    }
  } else {
    console.log('⚡ Modo Estado Operativo en Memoria Activado (alta fidelidad listo para desarrollo y pruebas).');
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`====================================================`);
    console.log(`PLATINUMVIP · Centro de Control Operativo Activo`);
    console.log(`URL Local: http://localhost:${port}`);
    console.log(`Dashboard: http://localhost:${port}/dashboard`);
    console.log(`====================================================`);
  });
}

start().catch(error => {
  console.error('Error al iniciar:', error.message);
  process.exit(1);
});
