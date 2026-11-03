// Run inside the backend image on the Compose network. Creates and drops its own database.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Pool}=require('pg');
const express=require('express');
const axios=require('axios');
const database=`platinum_automation_test_${Date.now()}`;
const admin=new Pool({host:process.env.POSTGRES_HOST,database:process.env.POSTGRES_DB,user:process.env.POSTGRES_USER,password:process.env.POSTGRES_PASSWORD});
let pool,server;
async function run(){
  await admin.query(`CREATE DATABASE ${database}`);process.env.POSTGRES_DB=database;
  pool=require('../src/db/pool');
  // Simulate an existing installation, including a call ID from the retired provider.
  await pool.query(fs.readFileSync('/app/database/init.sql','utf8').replace('external_call_id VARCHAR(150)','twilio_call_sid VARCHAR(100)'));
  await pool.query("INSERT INTO llamadas(twilio_call_sid) VALUES('old-call')");
  const migration=fs.readFileSync('/app/backend-web/src/db/operaciones.sql','utf8');
  await pool.query(migration);await pool.query(migration);
  assert.equal((await pool.query('SELECT external_call_id FROM llamadas')).rows[0].external_call_id,'old-call');
  process.env.INTEGRATION_API_TOKEN='integration-test-token';
  process.env.ZELLO_BRIDGE_ENABLED='true';process.env.ZELLO_API_URL='https://bridge.invalid';process.env.ZELLO_API_TOKEN='test';
  process.env.WHATSAPP_ACCESS_TOKEN='test';process.env.WHATSAPP_PHONE_NUMBER_ID='test';process.env.WHATSAPP_GRAPH_VERSION='v-test';process.env.WHATSAPP_TEMPLATE_NAME='test';
  let sent=0,radio=0;
  axios.defaults.adapter=async config=>{
    if(config.url==='https://bridge.invalid'){radio++;return {data:{accepted:true},status:200,headers:{},config};}
    if(config.url.startsWith('https://graph.facebook.com/')){sent++;return {data:{messages:[{id:'message-'+sent}]},status:200,headers:{},config};}
    throw new Error('Unexpected outbound request: '+config.url);
  };
  const app=express();app.use(express.json({verify:(req,_res,buffer)=>{req.rawBody=buffer;}}));app.use('/w',require('../src/routes/whatsapp'));app.use('/i',require('../src/routes/integraciones'));app.use('/api',require('../src/routes/operaciones'));app.use('/api',require('../src/routes/api'));
  app.use((e,_req,res,_next)=>res.status(e.status || 500).json({error:e.message}));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  async function request(path,body,expected=200,token='integration-test-token'){
    const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Integration-Token':token},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
  }
  await request('/i/n8n/crear-servicio',{},403,'wrong');
  await request('/i/n8n/crear-servicio',{},400);
  const body={external_request_id:'request-1',nombre:'Cliente',telefono:'+51999000111',origen:'Real Plaza',destino:'Aeropuerto',categoria:'sedan'};
  const [one,two]=await Promise.all([request('/i/n8n/crear-servicio',body,201),request('/i/n8n/crear-servicio',body)]);
  assert.equal(one.id,two.id);assert.equal(radio,0);
  await request('/i/n8n/buscar-unidad',{servicio_id:one.id});await request('/i/n8n/buscar-unidad',{servicio_id:one.id});assert.equal(radio,1);
  const person=(await pool.query("INSERT INTO personas_conductoras(codigo,nombre,telefono) VALUES('P1','Conductor','+51999000222') RETURNING *")).rows[0];
  const unit=(await pool.query("INSERT INTO conductores(codigo,nombre,placa,categoria,chofer_id) VALUES('024','','ABC123','sedan',$1) RETURNING *",[person.id])).rows[0];
  const reply=await request('/i/zello/respuestas',{external_id:'z1',servicio_id:one.id,contenido:'Unidad 024 disponible'});
  const dup=await request('/i/zello/respuestas',{external_id:'z1',servicio_id:one.id,contenido:'Unidad 024 disponible'});assert.equal(reply.id,dup.id);
  await request('/i/n8n/asignar-conductor',{respuesta_id:reply.id});await request('/i/n8n/asignar-conductor',{respuesta_id:reply.id});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM asignaciones')).rows[0].n,1);
  const second=await request('/i/n8n/crear-servicio',{...body,external_request_id:'request-2'},201);
  const reply2=await request('/i/zello/respuestas',{external_id:'z2',servicio_id:second.id,contenido:'Unidad 024 disponible'});
  await request('/i/n8n/asignar-conductor',{respuesta_id:reply2.id},409);
  await request('/i/n8n/notificar-whatsapp',{servicio_id:one.id});await request('/i/n8n/notificar-whatsapp',{servicio_id:one.id});assert.equal(sent,2);
  process.env.WHATSAPP_APP_SECRET='test-signing-secret';
  const {createHmac}=require('node:crypto');
  async function callback(status,valid=true){
    const body=JSON.stringify({entry:[{changes:[{value:{statuses:[{id:'message-1',status}]}}]}]});
    const signature='sha256='+createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(body).digest('hex');
    const response=await fetch(base+'/w',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':valid?signature:'sha256=invalid'},body});
    assert.equal(response.status,valid?200:403);
  }
  await callback('read',false);await callback('read');await callback('delivered');
  assert.equal((await pool.query("SELECT estado FROM notificaciones_whatsapp WHERE external_id='message-1'")).rows[0].estado,'LEIDO');
  await callback('failed');assert.equal((await pool.query("SELECT estado FROM notificaciones_whatsapp WHERE external_id='message-1'")).rows[0].estado,'LEIDO');
  const events=await request(`/api/servicios/${one.id}/eventos`);assert(events.some(e=>e.tipo==='CLIENTE_NOTIFICADO'));assert(events.some(e=>e.tipo==='CONDUCTOR_NOTIFICADO'));
  const call={external_call_id:'azure-1',telefono:'+51999000111',message_id:'m1',rol:'usuario',contenido:'Necesito un taxi'};
  const c=await request('/i/azure/llamadas',call);await request('/i/azure/llamadas',call);
  assert.equal((await request(`/api/llamadas/${c.id}/conversacion`)).length,1);
  await pool.context.run({schema:'empresa_999'},async()=>{
    await assert.rejects(()=>require('../src/services/azure.service').responder('Hola'),{status:503});
    const aviso=await require('../src/services/zello.service').enviarSolicitudServicio(one);assert.equal(aviso.enviado,false);
  });
  console.log('OK: repeatable legacy migration, webhook authentication, concurrent idempotency, Zello replies, assignment validation, no double dispatch, WhatsApp deduplication, timeline, call transcripts and company isolation.');
}
run().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(server)await new Promise(resolve=>server.close(resolve));if(pool)await pool.end();await admin.query(`DROP DATABASE IF EXISTS ${database}`);await admin.end();
});
