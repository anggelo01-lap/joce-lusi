const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'../../frontend');
const elements=new Map();
const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:''});return elements.get(id);},addEventListener(){}};
const context=vm.createContext({document,console});
for(const file of ['flota.js','dashboard.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
vm.runInContext(`state.people=[
  {id:1,codigo:'P1',nombre:'Ana <script>',activo:true,unidad_id:9,unidad_codigo:'U1',placa:'ABC'},
  {id:2,codigo:'P2',nombre:'Luis',activo:true,unidad_id:null},
  {id:3,codigo:'P3',nombre:'Juan',activo:false,unidad_id:null}
];renderPeople();`,context);
assert.match(document.getElementById('peopleList').innerHTML,/Ana &lt;script&gt;/);
assert.doesNotMatch(document.getElementById('peopleList').innerHTML,/<script>/);
document.getElementById('personFilter').value='free';vm.runInContext('renderPeople()',context);
assert.match(document.getElementById('peopleList').innerHTML,/Luis/);
assert.doesNotMatch(document.getElementById('peopleList').innerHTML,/Ana|Juan/);
document.getElementById('personFilter').value='';document.getElementById('personSearch').value='p3';vm.runInContext('renderPeople()',context);
assert.match(document.getElementById('peopleList').innerHTML,/Juan/);
assert.doesNotMatch(document.getElementById('peopleList').innerHTML,/Luis/);
const html=fs.readFileSync(path.join(root,'dashboard.html'),'utf8');
const unitForm=html.match(/id="driverForm"[\s\S]*?<\/form>/)[0];
assert.doesNotMatch(unitForm,/name="(?:nombre|telefono)"/);
assert.match(html,/id="personForm"/);assert.match(html,/id="assignmentForm"/);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length);
console.log('OK: separate forms, person search and availability filters, escaped names and unique controls.');
