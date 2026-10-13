// Run in the backend container. Uses a separate disposable database, never the operational tables.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const load = createRequire('/app/backend-web/package.json');
const { Pool } = load('pg');
const express = load('express');
const database = `platinum_test_${Date.now()}`;
const admin = new Pool({host:process.env.POSTGRES_HOST || 'postgres',port:Number(process.env.POSTGRES_PORT || 5432),database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
let pool, server;
async function run() {
  await admin.query(`CREATE DATABASE ${database}`);
  process.env.POSTGRES_DB=database;
  delete process.env.ZELLO_API_URL;delete process.env.ZELLO_API_TOKEN;
  pool=load('/app/backend-web/src/db/pool');
  await pool.query(fs.readFileSync('/app/backend-web/src/db/base.sql','utf8'));
  const migration=fs.readFileSync('/app/backend-web/src/db/operaciones.sql','utf8');
  await pool.query(migration);await pool.query(migration);
  const app=express();app.use(express.json());app.use('/api',load('/app/backend-web/src/routes/operaciones'));app.use('/api',load('/app/backend-web/src/routes/api'));
  app.use((error,_req,res,_next)=>res.status(error.status || (error.code==='23505'?409:500)).json({error:error.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  async function request(url,method='GET',body,expected=200) {
    const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));return result;
  }
  const driver=await request('/conductores','POST',{codigo:'TEST-1',nombre:'Unidad de prueba',placa:'TEST-001',vehiculo:'Vehículo de prueba',categoria:'sedan'},201);
  await request('/conductores','POST',{codigo:'TEST-1',nombre:'Duplicado',placa:'TEST-001',vehiculo:'Prueba',categoria:'sedan'},409);
  const create=()=>request('/servicios','POST',{nombre:'Cliente de prueba',telefono:'TEST-ONLY',origen:'Origen de prueba',destino:'Destino de prueba',categoria:'sedan'},201);
  const [one,two]=await Promise.all([create(),create()]);assert.notEqual(one.codigo,two.codigo);
  const results=await Promise.all([one,two].map(service=>fetch(base+`/servicios/${service.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({estado:'ASIGNADO',conductor_id:driver.id})})));
  const details=await Promise.all(results.map(r=>r.json()));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409],JSON.stringify(details));
  const chosen=[one,two][results.findIndex(r=>r.status===200)];
  await request(`/servicios/${chosen.id}`,'PATCH',{estado:'COMPLETADO'},409);
  await request(`/servicios/${chosen.id}`,'PATCH',{estado:'EN_RECOJO'});
  await request(`/servicios/${chosen.id}`,'PATCH',{estado:'EN_CURSO'});
  for(const [when,latitude] of [['2026-10-10T10:00:00-05:00',-8.11],['2026-10-10T09:00:00-05:00',-8.12],['2026-10-11T00:10:00-05:00',-8.13]]) {
    await request(`/conductores/${driver.id}/posiciones`,'POST',{latitud:latitude,longitud:-79.02,registrado_en:when,servicio_id:chosen.id,fuente:'manual'},201);
  }
  const drivers=await request('/conductores');assert.equal(Number(drivers[0].latitud),-8.13);
  const route=await request(`/conductores/${driver.id}/recorrido?fecha=2026-10-10&servicio_id=${chosen.id}`);
  assert.equal(route.puntos.length,2);assert.equal(Number(route.puntos[0].latitud),-8.12);
  await request(`/conductores/${driver.id}/recorrido?fecha=2026-02-30`,'GET',undefined,400);
  await request(`/conductores/${driver.id}/posiciones`,'POST',{latitud:91,longitud:-79},400);
  await request(`/conductores/${driver.id}/posiciones`,'POST',{latitud:-8,longitud:-79,registrado_en:'2026-10-10T09:00:00'},400);
  await request('/conductores/999999/posiciones','POST',{latitud:-8,longitud:-79},404);
  await request(`/conductores/${driver.id}/posiciones`,'POST',{latitud:-8,longitud:-79,servicio_id:two.id===chosen.id?one.id:two.id},400);
  await request(`/servicios/${chosen.id}`,'PATCH',{estado:'COMPLETADO',tarifa:35.5});
  const completed=(await request('/servicios')).find(s=>s.id===chosen.id);
  assert.ok(completed.finalizado_en);
  await request(`/servicios/${chosen.id}`,'PATCH',{estado:'COMPLETADO',tarifa:40});
  assert.equal((await request('/servicios')).find(s=>s.id===chosen.id).finalizado_en,completed.finalizado_en);
  const freed=await request('/conductores');assert.equal(freed[0].estado,'DISPONIBLE');
  await request('/configuracion','PUT',{empresa:'Central de prueba',intervalo_segundos:45});
  const config=await request('/configuracion');assert.equal(config.empresa,'Central de prueba');assert.equal(config.ciudad,'Trujillo');
  await request('/configuracion','PUT',{empresa:'Prueba',intervalo_segundos:1},400);
  const summary=await request('/resumen');assert.equal(summary.unidades.total,1);assert.equal(summary.servicios.activos,1);
  const persisted=await pool.query('SELECT COUNT(*)::int AS n FROM posiciones_unidad');assert.equal(persisted.rows[0].n,3);
  console.log('OK: migration twice, concurrent creation/assignment, state transitions, tariff, unit release, GPS history, Peru date boundaries, invalid requests, configuration and summary.');
}
run().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${database}`);await admin.end();
});
