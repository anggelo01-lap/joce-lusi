'use strict';
const operationalWorkflow = {calls:[],responses:[],selectedService:null,map:null,points:{},filtered:[]};
const opDate = value => value ? new Date(value).toLocaleString('es-PE',{timeZone:'America/Lima'}) : '—';
const opStatus = value => PlatinumAnalitica.status(value);
const opEsc = value => moduleEscape(value);
function opGrid(headers,rows) {
  return `<div class="op-table-scroll"><table class="clean-table"><thead><tr>${headers.map(h=>`<th>${opEsc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">Sin registros para estos filtros.</td></tr>`}</tbody></table></div>`;
}
const opCell = value => `<td>${opEsc(value ?? '—')}</td>`;
const opBadge = value => `<td><span class="status-pill ${getStatusClass(value)}">${opEsc(value)}</span></td>`;
function opTools(id,placeholder,dates=false) {
  return `<div class="op-toolbar"><input class="form-input" id="${id}Search" type="search" aria-label="Buscar" placeholder="${placeholder}"><select class="form-input" id="${id}Status" aria-label="Estado"><option value="">Todos los estados</option>${['Solicitado','Asignado','En curso','Completado','Cancelado'].map(s=>`<option>${s}</option>`).join('')}</select>${dates?`<label>Desde<input class="form-input" id="${id}From" type="date"></label><label>Hasta<input class="form-input" id="${id}To" type="date"></label>`:''}</div>`;
}
function opMatches(rows,id) {
  const search=$(id+'Search').value.toLocaleLowerCase(), state=$(id+'Status').value;
  const from=$(id+'From')?.value,to=$(id+'To')?.value;
  return rows.filter(s=>JSON.stringify([s.codigo,s.cliente,s.telefono_cliente,s.origen,s.destino,s.conductor,s.unidad_codigo]).toLocaleLowerCase().includes(search) && (!state || opStatus(s.estado)===opStatus(state)) && (!from || PlatinumAnalitica.dayKey(s.creado_en)>=from) && (!to || PlatinumAnalitica.dayKey(s.creado_en)<=to));
}
function opServiceRows(services,actions=true) {
  return services.map(s=>[opCell(s.codigo),opCell(s.cliente),opCell(s.telefono_cliente),opCell(s.origen),opCell(s.destino),opCell(opDate(s.creado_en)),opCell(s.conductor || s.unidad_codigo || 'Sin asignar'),opBadge(s.estado),opCell(money(s.tarifa)),...(actions?[`<td><button class="btn-secondary-white" data-op-edit="${Number(s.id)}">Editar</button></td>`]:[])]);
}
const opServiceHeaders=['Código','Cliente','Teléfono','Recojo','Destino','Fecha','Conductor / unidad','Estado','Tarifa'];
function opBindEdits() {
  document.querySelectorAll('[data-op-edit]').forEach(b=>b.onclick=()=>abrirModalEditarSolicitud(Number(b.dataset.opEdit)));
}
async function renderWorkflowModules() {
  const outcomes=await Promise.allSettled([api('/centro/llamadas').catch(async error=>{if(error.status!==404)throw error;const calls=await api('/llamadas');return calls.map(c=>({...c,solicitudes:appState.servicios.filter(s=>s.llamada_id===c.id)}));}),api('/centro/disponibilidad')]);
  operationalWorkflow.calls=outcomes[0].status==='fulfilled'?outcomes[0].value:[];
  operationalWorkflow.responses=outcomes[1].status==='fulfilled'?outcomes[1].value:[];
  renderCallsWorkflow(outcomes[0].status==='rejected');renderRequestsWorkflow();renderDispatchWorkflow(outcomes[1].status==='rejected');renderReportsWorkflow();renderPassengersWorkflow();renderServiceMap();
  renderDriverAvailability();
}
function renderCallsWorkflow(failed) {
  modulePanel('recepcion-llamadas','Recepción de llamadas',`<p>Cliente, duración, datos capturados y solicitudes vinculadas por llamada. Los registros de ejemplo no acreditan una conexión activa con Azure.</p>${failed?'<p role="alert">No se pudieron cargar las llamadas. Recarga para reintentar.</p>':''}<div class="op-toolbar"><input id="callSearch" class="form-input" type="search" placeholder="Buscar cliente, teléfono o solicitud" aria-label="Buscar llamadas"></div><div id="callsWorkflowTable"></div>`);
  const render=()=>{
    const term=$('callSearch').value.toLowerCase();
    const calls=operationalWorkflow.calls.filter(c=>JSON.stringify(c).toLowerCase().includes(term));
    $('callsWorkflowTable').innerHTML=opGrid(['Fecha','Cliente','Teléfono','Duración','Estado','Solicitudes','Datos capturados / transcripción'],calls.map(c=>[
      opCell(opDate(c.inicio)),opCell(c.cliente),opCell(c.telefono_origen),opCell(`${c.duracion_segundos ?? '—'} s`),opBadge(c.estado),
      `<td>${c.solicitudes.length?c.solicitudes.map(s=>`<button class="btn-secondary-white" data-op-edit="${Number(s.id)}">${opEsc(s.codigo)}</button>`).join(''):'Sin solicitud vinculada'}</td>`,
      `<td><details><summary>Ver conversación y extracción</summary><p>${opEsc(c.resumen_ia || '')}</p><dl>${Object.entries(c.datos_extraidos || {}).map(([key,value])=>`<dt>${opEsc(key)}</dt><dd>${opEsc(value)}</dd>`).join('')}</dl><pre class="op-transcript">${opEsc(c.transcripcion || 'Sin transcripción')}</pre><small>${opEsc(c.agente_voz || 'Origen no registrado')}</small></details></td>`]));opBindEdits();
  };$('callSearch').oninput=render;render();
}
function renderRequestsWorkflow() {
  modulePanel('solicitudes','Gestión de solicitudes',`<div class="op-heading"><p>Consulta y gestiona solicitudes registradas.</p><button id="workflowNewRequest" class="btn-primary-blue">Nueva solicitud</button></div>${opTools('requests','Cliente, teléfono, dirección o código',true)}<div id="requestsWorkflowTable"></div>`);
  const render=()=>{$('requestsWorkflowTable').innerHTML=opGrid([...opServiceHeaders,'Acción'],opServiceRows(opMatches(appState.servicios,'requests')));opBindEdits();};
  document.querySelectorAll('#view-solicitudes input,#view-solicitudes select').forEach(el=>el.oninput=render);
  $('workflowNewRequest').onclick=()=>$('modalNuevaSolicitud').classList.add('open');render();
}
function renderDriverAvailability() {
  const section=$('view-conductores-unidades');
  let box=$('driverAvailability');if(!box){box=document.createElement('div');box.id='driverAvailability';section.append(box);}
  box.className='module-container-card';
  if(appState.loadErrors?.pasajeros){box.textContent='El historial de pasajeros no está disponible en esta versión del backend.';return;}
  box.innerHTML='<h3>Disponibilidad reportada por Zello</h3><p>Respuestas registradas por el operador; el estado de una unidad no sustituye una respuesta para un servicio específico.</p>'+opGrid(['Unidad','Conductor','Contacto','Canal','Última respuesta','Fecha'],appState.conductores.map(d=>{
    const response=operationalWorkflow.responses.filter(r=>r.conductor_id===d.id).at(-1);
    return [opCell(d.codigo),opCell(d.nombre),opCell(d.telefono),opCell(d.canal_zello || 'Sin canal'),opCell(response?(response.disponible?'Disponible':'No disponible'):'Sin respuesta registrada'),opCell(opDate(response?.creado_en))];
  }));
}
function renderDispatchWorkflow(failed) {
  const pending=appState.servicios.filter(s=>!['COMPLETADO','CANCELADO'].includes(opStatus(s.estado)));
  modulePanel('asignacion-servicios','Asignación de servicios',`<p>Registra la respuesta escuchada en Zello y asigna una unidad. El registro manual no transmite mensajes al proveedor.</p>${failed?'<p role="alert">No se pudieron consultar las respuestas.</p>':''}<div class="op-dispatch-grid"><div><h4>Servicios pendientes</h4>${pending.map(s=>`<button class="op-service-card" data-dispatch-service="${Number(s.id)}"><strong>${opEsc(s.codigo)}</strong><span>${opEsc(s.cliente)}</span><span>Recojo: ${opEsc(s.origen)}</span><span>Destino: ${opEsc(s.destino)}</span><small>${opEsc(s.estado)} · ${opEsc(s.unidad_codigo || 'Sin unidad')}</small></button>`).join('')||'<p>No hay servicios pendientes.</p>'}</div><div id="dispatchDetail"><p>Selecciona un servicio para consultar sus respuestas.</p></div></div>`);
  document.querySelectorAll('[data-dispatch-service]').forEach(b=>b.onclick=()=>renderDispatchDetail(Number(b.dataset.dispatchService)));
}
function renderDispatchDetail(id) {
  const s=appState.servicios.find(s=>s.id===id);if(!s)return;
  operationalWorkflow.selectedService=id;
  const responses=operationalWorkflow.responses.filter(r=>r.servicio_id===id);
  $('dispatchDetail').innerHTML=`<h4>${opEsc(s.codigo)} · ${opEsc(s.cliente)}</h4><p>${opEsc(s.origen)} → ${opEsc(s.destino)}</p><form id="availabilityForm" class="op-form"><label>Conductor y unidad<select class="form-input" name="conductor_id" required>${appState.conductores.map(d=>`<option value="${Number(d.id)}">${opEsc(d.codigo)} · ${opEsc(d.nombre)}</option>`).join('')}</select></label><label>Respuesta<select class="form-input" name="disponible"><option value="true">Disponible</option><option value="false">No disponible</option></select></label><label>Mensaje recibido en Zello<textarea class="form-input" name="contenido" maxlength="1000" required></textarea></label><button class="btn-primary-blue" type="submit">Registrar respuesta</button><p role="alert" id="dispatchError"></p></form><h4>Respuestas recibidas</h4>${responses.map(r=>`<article class="op-response"><strong>${opEsc(r.unidad)} · ${opEsc(r.conductor)}</strong><p>${opEsc(r.contenido)}</p><small>${opDate(r.creado_en)} · ${r.disponible?'Disponible':'No disponible'} · registro manual</small>${r.disponible?`<button class="btn-secondary-white" data-assign-response="${r.id}">Asignar esta unidad</button>`:''}</article>`).join('')||'<p>Aún no hay respuestas para este servicio.</p>'}`;
  $('availabilityForm').onsubmit=async event=>{
    event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
    const data=Object.fromEntries(new FormData(event.target));
    try {await api('/centro/disponibilidad',{method:'POST',body:JSON.stringify({...data,servicio_id:id,conductor_id:Number(data.conductor_id),disponible:data.disponible==='true'})});operationalWorkflow.responses=await api('/centro/disponibilidad');renderDispatchDetail(id);}catch(error){$('dispatchError').textContent=error.message;button.disabled=false;}
  };
  document.querySelectorAll('[data-assign-response]').forEach(b=>b.onclick=async()=>{
    b.disabled=true;try{await api('/centro/asignaciones',{method:'POST',body:JSON.stringify({respuesta_id:Number(b.dataset.assignResponse)})});await initApp();renderDispatchDetail(id);showToast('Unidad asignada.');}catch(error){$('dispatchError').textContent=error.message;b.disabled=false;}
  });
}
function renderReportsWorkflow() {
  modulePanel('historial-reportes','Historial y reportes',`${opTools('reports','Cliente, conductor, unidad o dirección',true)}<div id="reportStats" class="op-stats"></div><button id="workflowExport" class="btn-secondary-white">Exportar resultados CSV</button><div id="reportsWorkflowTable"></div>`);
  const render=()=>{
    const rows=opMatches(appState.servicios,'reports');operationalWorkflow.filtered=rows;
    const completed=rows.filter(s=>opStatus(s.estado)==='COMPLETADO'),cancelled=rows.filter(s=>opStatus(s.estado)==='CANCELADO');
    $('reportStats').innerHTML=[['Servicios',rows.length],['Atendidos',completed.length],['Cancelados',cancelled.length],['Tarifas completadas',money(completed.reduce((a,s)=>a+Number(s.tarifa || 0),0))]].map(([label,value])=>`<article><span>${label}</span><strong>${opEsc(value)}</strong></article>`).join('');
    $('reportsWorkflowTable').innerHTML=opGrid(opServiceHeaders,opServiceRows(rows,false));
  };document.querySelectorAll('#view-historial-reportes input,#view-historial-reportes select').forEach(el=>el.oninput=render);
  $('workflowExport').onclick=()=>exportWorkflowRows(operationalWorkflow.filtered);render();
}
function exportWorkflowRows(rows) {
  const cell=value=>'"'+(/^[=+@\-\t\r\n]/.test(String(value??''))?"'":'')+String(value??'').replaceAll('"','""')+'"';
  const content=[opServiceHeaders,...rows.map(s=>[s.codigo,s.cliente,s.telefono_cliente,s.origen,s.destino,opDate(s.creado_en),s.conductor || s.unidad_codigo,s.estado,s.tarifa])].map(r=>r.map(cell).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+content],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='reporte-servicios.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function renderPassengersWorkflow() {
  let box=$('passengerHistory');if(!box){box=document.createElement('div');box.id='passengerHistory';$('view-pasajeros').append(box);}box.className='module-container-card';
  if(appState.loadErrors?.pasajeros){box.textContent='El historial de pasajeros no está disponible en esta versión del backend.';return;}
  box.innerHTML=`<h3>Historial de pasajeros</h3><p>Consulta llamadas, servicios anteriores, destinos y conductores asignados.</p><div class="op-toolbar"><input id="passengerHistorySearch" class="form-input" type="search" placeholder="Buscar nombre o teléfono" aria-label="Buscar pasajero"></div><div id="passengerHistoryList"></div><div id="passengerHistoryDetail"></div>`;
  const render=()=>{
    const term=$('passengerHistorySearch').value.toLowerCase();$('passengerHistoryList').innerHTML=appState.pasajeros.filter(p=>`${p.nombre} ${p.telefono}`.toLowerCase().includes(term)).map(p=>`<button class="btn-secondary-white" data-passenger-history="${Number(p.id)}">${opEsc(p.nombre)} · ${opEsc(p.telefono)}</button>`).join('')||'<p>Sin coincidencias.</p>';
    document.querySelectorAll('[data-passenger-history]').forEach(b=>b.onclick=async()=>{
      const detail=$('passengerHistoryDetail');detail.textContent='Cargando historial...';
      try{const h=await api(`/centro/pasajeros/${Number(b.dataset.passengerHistory)}/historial`);detail.innerHTML=`<h4>${opEsc(h.cliente.nombre)}</h4><p>${h.totales.llamadas} llamadas · ${h.totales.completados} atendidos · ${h.totales.cancelados} cancelados</p><h4>Servicios</h4>${opGrid(opServiceHeaders,opServiceRows(h.servicios,false))}<h4>Llamadas</h4>${moduleTable(['Fecha','Teléfono','Duración (s)','Resumen'],h.llamadas.map(c=>[opDate(c.inicio),c.telefono_origen,c.duracion_segundos,c.resumen_ia]))}`;}catch(error){detail.textContent=error.message;}
    });
  };$('passengerHistorySearch').oninput=render;render();
}
function renderServiceMap() {
  // Recreate only the service map; it never subscribes to driver GPS updates.
  if(operationalWorkflow.map){operationalWorkflow.map.remove();operationalWorkflow.map=null;}
  modulePanel('mapa-servicios','Mapa de servicios',`<p>Recojo y destino por servicio. Selecciona un servicio y marca sus dos puntos en el mapa; no se requiere GPS permanente ni se geocodifican direcciones automáticamente.</p><div class="op-map-grid"><div><label>Servicio<select class="form-input" id="mapService"><option value="">Seleccionar servicio</option>${appState.servicios.map(s=>`<option value="${Number(s.id)}">${opEsc(s.codigo)} · ${opEsc(s.cliente)}</option>`).join('')}</select></label><div id="serviceMapDetail"></div></div><div id="servicePointsMap" style="height:540px;min-height:320px"></div></div>`);
  $('mapService').onchange=()=>selectServiceMap(Number($('mapService').value));
}
function ensureServiceMap() {
  if(operationalWorkflow.map){operationalWorkflow.map.invalidateSize();return;}
  if(typeof L==='undefined'){$('servicePointsMap').textContent='No se pudo cargar el mapa. Comprueba tu conexión.';return;}
  const map=L.map('servicePointsMap').setView([-8.1116,-79.0287],13);operationalWorkflow.map=map;
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
  operationalWorkflow.markers=L.layerGroup().addTo(map);
  map.on('click',event=>{
    if(!$('mapService').value)return showToast('Selecciona primero un servicio.');
    operationalWorkflow.points[$('mapPointType').value]={lat:event.latlng.lat,lng:event.latlng.lng};drawServicePoints();
  });
  if($('mapService').value)selectServiceMap(Number($('mapService').value));
}
function selectServiceMap(id) {
  const service=appState.servicios.find(s=>s.id===id);operationalWorkflow.points=structuredClone(service?.puntos || {});
  $('serviceMapDetail').innerHTML=service?`<article class="op-service-card"><strong>${opEsc(service.codigo)}</strong><span>Recojo: ${opEsc(service.origen)}</span><span>Destino: ${opEsc(service.destino)}</span></article><label>Punto a marcar<select class="form-input" id="mapPointType"><option value="recojo">Recojo</option><option value="destino">Destino</option></select></label><p>Haz clic en el mapa para ubicar el punto seleccionado.</p><div id="mapPointSummary"></div><button class="btn-primary-blue" id="saveMapPoints">Guardar puntos</button><p role="status" id="mapPointsStatus"></p>`:'';
  if(service)$('saveMapPoints').onclick=async()=>{
    const {recojo,destino}=operationalWorkflow.points;if(!recojo || !destino){$('mapPointsStatus').textContent='Marca ambos puntos antes de guardar.';return;}
    const button=$('saveMapPoints');button.disabled=true;try{const updated=await api(`/centro/servicios/${id}/puntos`,{method:'PUT',body:JSON.stringify({recojo,destino})});Object.assign(service,updated);$('mapPointsStatus').textContent='Puntos guardados para este servicio.';}catch(error){$('mapPointsStatus').textContent=error.message;}finally{button.disabled=false;}
  };drawServicePoints();
}
function drawServicePoints() {
  if(!operationalWorkflow.map)return;
  operationalWorkflow.markers.clearLayers();const points=operationalWorkflow.points,bounds=[];
  for(const [type,p] of Object.entries(points)){
    if(!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng))continue;
    bounds.push([p.lat,p.lng]);L.circleMarker([p.lat,p.lng],{radius:9,color:type==='recojo'?'#059669':'#2563eb'}).bindPopup(type==='recojo'?'Punto de recojo':'Destino').addTo(operationalWorkflow.markers);
  }
  if(bounds.length===2)L.polyline(bounds,{color:'#64748b',dashArray:'5 8'}).bindPopup('Conexión de referencia entre puntos; no es una ruta calculada.').addTo(operationalWorkflow.markers);
  if(bounds.length)operationalWorkflow.map.fitBounds(bounds,{padding:[45,45],maxZoom:15});
  if($('mapPointSummary'))$('mapPointSummary').innerHTML=Object.entries(points).map(([type,p])=>`<p>${type==='recojo'?'Recojo':'Destino'}: ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</p>`).join('');
}

document.addEventListener('DOMContentLoaded',()=>{
  $('solUnidad').innerHTML='<option value="">Se asigna en Despacho</option>';
  $('solUnidad').disabled=true;
  $('solEstado').innerHTML='<option value="Solicitado">Solicitado</option>';
});
