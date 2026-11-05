const test=require('node:test');
const assert=require('node:assert/strict');
const {loadDashboardData}=require('../../frontend/dashboard-data');
test('missing passenger route does not discard loaded units, services or summary',async()=>{
  const paths=[];
  const {data,errors}=await loadDashboardData(async route=>{
    paths.push(route);
    if(route==='/pasajeros')throw Object.assign(new Error('Endpoint no encontrado.'),{status:404});
    if(route==='/conductores')return [{id:1},{id:2},{id:3}];
    if(route==='/resumen')return {servicios:{activos:0}};
    if(route==='/health')return {database:true};
    return [];
  });
  assert.equal(data.conductores.length,3);assert.equal(data.resumen.servicios.activos,0);
  assert.ok(errors.pasajeros);assert.ok(paths.includes('/acceso/usuarios'));assert.ok(!paths.includes('/usuarios'));
});
test('an expired session remains an authentication failure',async()=>{
  await assert.rejects(loadDashboardData(async()=>{throw Object.assign(new Error('Inicia sesión'),{status:401});}),error=>error.status===401);
});
test('unexpected list format is isolated to its module',async()=>{
  const {data,errors}=await loadDashboardData(async route=>route==='/usuarios'?[]:route==='/acceso/usuarios'?{error:'Not a list'}:[]);
  assert.ok(errors.usuarios);assert.deepEqual(data.usuarios,[]);
});
