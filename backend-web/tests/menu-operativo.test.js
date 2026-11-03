const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const pool = require('../src/db/pool');
const router = require('../src/routes/operaciones');
const analytics = require('../../frontend/presentacion-analitica');
const path = require('node:path');
function request(route, method, body={}) {
  const layer=router.stack.find(l=>l.route && (Array.isArray(l.route.path)?l.route.path.includes(route):l.route.path===route) && l.route.methods[method]);
  assert.ok(layer, route);
  return new Promise((resolve,reject)=>layer.route.stack[0].handle({body},{status(){return this;},json:resolve},reject));
}
test('summary counts the actual memory records and preserves zero revenue',async()=>{
  const before=pool.store.servicios;
  try {pool.store.servicios=[]; const summary=await request('/resumen','get');assert.equal(summary.servicios.activos,0);assert.equal(summary.servicios.facturado_hoy,0);assert.equal(summary.fuente,'memoria');}
  finally {pool.store.servicios=before;}
});
test('registering units does not invent a GPS position or reuse a deleted identifier',async()=>{
  const before=pool.store.conductores;
  try {pool.store.conductores=[{id:20}]; const unit=await request('/conductores','post',{codigo:'TEST',nombre:'Prueba',placa:'TEST-1',telefono:'999999999',vehiculo:'Auto'});assert.equal(unit.id,21);assert.equal(unit.latitud,null);assert.equal(unit.longitud,null);}
  finally {pool.store.conductores=before;}
});
test('every sidebar entry has a matching section and controls target existing elements',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../../frontend/dashboard.html'),'utf8');
  const views=[...html.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(views).size,12);
  for(const view of views) assert.ok(html.includes(`id="view-${view}"`),view);
  const script=fs.readFileSync(path.join(__dirname,'../../frontend/modulos-operativos.js'),'utf8');
  for(const match of script.matchAll(/getElementById\('([^']+)'\)/g)) {
    if(match[1]==='exportServices') continue;
    assert.ok(html.includes(`id="${match[1]}"`),match[1]);
  }
});
test('module loading isolates API failures and escapes external text',async()=>{
  const elements={}; const element=id=>elements[id] ||= {};
  const context=vm.createContext({
    document:{getElementById:element,querySelectorAll:()=>[],addEventListener(){}},
    api:async route=>{if(route==='/llamadas')return [{transcripcion:'<img src=x onerror=alert(1)>'}];throw Error('offline');},
    appState:{servicios:[]},PlatinumAnalitica:analytics
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../../frontend/modulos-operativos.js'),'utf8'),context);
  await vm.runInContext('refreshOperationalModules()',context);
  assert.match(elements['view-recepcion-llamadas'].innerHTML,/&lt;img/);
  assert.match(elements['view-configuraciones'].innerHTML,/No se pudo/);
  assert.match(elements['view-analisis-predictivo'].innerHTML,/insuficiente/);
  assert.match(elements.tbodyAuditoria.innerHTML,/No se pudo/);
});
