const test=require('node:test');
const assert=require('node:assert/strict');
const pool=require('../src/db/pool');
const router=require('../src/routes/centro-operativo');
function request(path,method,body={},params={}) {
  const layer=router.stack.find(l=>l.route?.path===path && l.route.methods[method]);
  assert.ok(layer,path);
  return new Promise((resolve,reject)=>{
    let code=200;
    try{layer.route.stack[0].handle({body,params,access:{nombre:'Prueba'}},{status(c){code=c;return this;},json(data){resolve({code,data});}},reject);}catch(error){reject(error);}
  });
}
test('calls include only requests explicitly linked to that call',async()=>{
  const {data}=await request('/centro/llamadas','get');
  const call=data.find(c=>c.id===1);
  assert.ok(call.cliente);assert.ok(call.solicitudes.length>0);
  assert.ok(call.solicitudes.every(s=>s.llamada_id===1));
});
test('passenger history isolates customers and returns not found for unknown passenger',async()=>{
  const {data}=await request('/centro/pasajeros/:id/historial','get',{}, {id:2});
  assert.ok(data.llamadas.length>0);assert.ok(data.servicios.every(s=>s.cliente_id===2 || s.telefono_cliente===data.cliente.telefono));
  assert.equal((await request('/centro/pasajeros/:id/historial','get',{}, {id:99999})).code,404);
});
test('dispatch requires available latest response and rejects double booking',async()=>{
  const before=pool.store.servicios,drivers=pool.store.conductores,audit=pool.store.auditoria;
  try{
    pool.store.servicios=[{id:901,codigo:'TEST-A',estado:'Solicitado'},{id:902,codigo:'TEST-B',estado:'Solicitado'}];
    pool.store.conductores=[{id:901,codigo:'TEST-U',nombre:'Prueba',estado:'DISPONIBLE'}];pool.store.auditoria=[];
    assert.equal((await request('/centro/asignaciones','post',{respuesta_id:99999})).code,400);
    const a=(await request('/centro/disponibilidad','post',{servicio_id:901,conductor_id:901,disponible:true,contenido:'Disponible por radio'})).data;
    await request('/centro/disponibilidad','post',{servicio_id:901,conductor_id:901,disponible:false,contenido:'Ya no disponible'});
    assert.equal((await request('/centro/asignaciones','post',{respuesta_id:a.id})).code,409);
    const b=(await request('/centro/disponibilidad','post',{servicio_id:901,conductor_id:901,disponible:true,contenido:'Disponible nuevamente'})).data;
    const assigned=await request('/centro/asignaciones','post',{respuesta_id:b.id});assert.equal(assigned.code,200);assert.equal(assigned.data.conductor_id,901);
    const c=(await request('/centro/disponibilidad','post',{servicio_id:902,conductor_id:901,disponible:true,contenido:'Disponible'})).data;
    assert.equal((await request('/centro/asignaciones','post',{respuesta_id:c.id})).code,409);
  }finally{pool.store.servicios=before;pool.store.conductores=drivers;pool.store.auditoria=audit;}
});
test('service map saves two fixed points and rejects invalid coordinates',async()=>{
  const before=pool.store.servicios;
  try{pool.store.servicios=[{id:990}];
    assert.equal((await request('/centro/servicios/:id/puntos','put',{recojo:{lat:100,lng:0},destino:{lat:0,lng:0}},{id:990})).code,400);
    const points={recojo:{lat:-8.11,lng:-79.02},destino:{lat:-8.12,lng:-79.03}};
    const result=await request('/centro/servicios/:id/puntos','put',points,{id:990});assert.equal(result.code,200);assert.deepEqual(result.data.puntos,points);assert.equal(result.data.latitud,undefined);
  }finally{pool.store.servicios=before;}
});
