'use strict';
function renderPeople(){
  const query=$('personSearch').value.trim().toLocaleLowerCase('es'),filter=$('personFilter').value;
  const people=state.people.filter(p=>(!filter || (filter==='active' && p.activo) || (filter==='inactive' && !p.activo) || (filter==='free' && p.activo && !p.unidad_id)) && [p.codigo,p.nombre,p.telefono,p.licencia].some(v=>String(v || '').toLocaleLowerCase('es').includes(query)));
  $('peopleCount').textContent=`${people.length} de ${state.people.length} conductores`;
  $('peopleList').innerHTML=people.length?people.map(p=>`<article class="card driver-card person-card"><div class="card-heading"><span class="tag">${escapeHTML(p.codigo)}</span>${badge(p.activo?'Activo':'Inactivo')}</div><div class="person-avatar" aria-hidden="true">${escapeHTML(p.nombre.trim().split(/\s+/).map(n=>n[0]).slice(0,2).join(''))}</div><h3>${escapeHTML(p.nombre)}</h3><p>Teléfono: ${escapeHTML(p.telefono || 'Sin registrar')}<br>Licencia: ${escapeHTML(p.licencia || 'Sin registrar')}</p><div class="person-assignment">${p.unidad_id?`Unidad actual: <strong>${escapeHTML(p.unidad_codigo)} · ${escapeHTML(p.placa)}</strong>`:'Sin unidad asignada'}</div><div class="driver-actions"><button class="secondary" data-person-edit="${p.id}">Editar conductor</button><button class="secondary danger-button" data-person-delete="${p.id}">Eliminar</button></div></article>`).join(''):empty(state.people.length?'No hay conductores que coincidan con los filtros.':'Registra un conductor y asígnalo a una unidad para comenzar.');
}
async function openPerson(id){
  const form=$('personForm');form.reset();$('personId').value='';
  if(id){
    try{
      const p=await api(`/personal-conductores/${id}`);
      for(const key of ['codigo','nombre','telefono','licencia'])form.elements[key].value=p[key];
      form.elements.activo.value=String(p.activo);$('personId').value=p.id;
    }catch(error){toast(error.message);return;}
  }
  $('personTitle').textContent=id?'Editar conductor':'Registrar conductor';$('personDialog').showModal();
}
async function openAssignment(id){
  try{
    const [unit,people]=await Promise.all([api(`/unidades/${id}`),api('/personal-conductores')]);
    $('assignmentUnit').value=unit.id;$('assignmentInfo').textContent=`${unit.codigo} · ${unit.placa} · ${unit.vehiculo}`;
    $('assignmentPerson').innerHTML='<option value="">Sin conductor</option>'+people.filter(p=>(p.activo && !p.unidad_id) || p.id===unit.chofer_id).map(p=>`<option value="${p.id}">${escapeHTML(p.codigo)} · ${escapeHTML(p.nombre)}</option>`).join('');
    $('assignmentPerson').value=unit.chofer_id || '';$('assignmentDialog').showModal();
  }catch(error){toast(error.message);}
}
function initFleet(){
  $('newPersonButton').onclick=()=>openPerson();$('personSearch').oninput=renderPeople;$('personFilter').onchange=renderPeople;
  document.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.fleetTab){
      const units=button.dataset.fleetTab==='units';$('fleetUnits').hidden=!units;$('fleetPeople').hidden=units;
      document.querySelectorAll('[data-fleet-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    }
    if(button.dataset.personEdit)openPerson(button.dataset.personEdit);
    if(button.dataset.unitAssign)openAssignment(button.dataset.unitAssign);
    if(button.dataset.personDelete){
      const p=state.people.find(p=>String(p.id)===button.dataset.personDelete);if(!p)return;
      if(!confirm(`¿Eliminar al conductor ${p.nombre}? Solo se permite si no está asignado y no tiene servicios registrados. Puedes desactivarlo para conservar su historial.`))return;
      button.disabled=true;
      try{await api(`/personal-conductores/${p.id}`,{method:'DELETE'});toast('Conductor eliminado.');await sync();}catch(error){toast(error.message);}finally{button.disabled=false;}
    }
  });
  submitForm($('personForm'),async()=>{
    const id=$('personId').value,body=Object.fromEntries(new FormData($('personForm')));body.activo=body.activo==='true';
    await api(id?`/personal-conductores/${id}`:'/personal-conductores',{method:id?'PUT':'POST',body:JSON.stringify(body)});
    $('personDialog').close();toast(id?'Conductor actualizado.':'Conductor registrado.');await sync();
  });
  submitForm($('assignmentForm'),async()=>{
    await api(`/unidades/${$('assignmentUnit').value}/conductor`,{method:'PUT',body:JSON.stringify({chofer_id:$('assignmentPerson').value?Number($('assignmentPerson').value):null})});
    $('assignmentDialog').close();toast('Asignación de conductor actualizada.');await sync();
  });
}
