'use strict';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const titles = {'panel-general':'Panel general','flujo-trabajo':'Flujo de trabajo','consola-ia':'Consola Orión','despacho-flujo':'Despacho y recorridos',unidades:'Unidades y conductores',conexiones:'Conexiones',api:'Documentación API',configuraciones:'Configuraciones'};
const states = ['SOLICITADO','ASIGNADO','EN_RECOJO','EN_CURSO','COMPLETADO','CANCELADO'];
const transitions = {SOLICITADO:['ASIGNADO','CANCELADO'],ASIGNADO:['EN_RECOJO','CANCELADO'],EN_RECOJO:['EN_CURSO','CANCELADO'],EN_CURSO:['COMPLETADO','CANCELADO'],COMPLETADO:[],CANCELADO:[]};
const state = {drivers:[],people:[],services:[],config:null,view:'panel-general',map:null,markers:null,route:null,points:[],routeMeta:null,routeRequest:0,syncing:false,timer:null};
const money = value => value==null?'Sin tarifa':new Intl.NumberFormat('es-PE',{style:'currency',currency:'PEN'}).format(Number(value));
const dateTime = value => value?new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',dateStyle:'short',timeStyle:'short'}).format(new Date(value)):'Sin fecha';
const peruDay = () => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const peruLocal = () => { const parts = new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()); return parts.replace(' ','T'); };
const badge = value => `<span class="status status-${escapeHTML(String(value).toLowerCase().replace(/ /g,'_'))}">${escapeHTML(String(value).replace(/_/g,' '))}</span>`;
const empty = message => `<div class="empty">${escapeHTML(message)}</div>`;
function toast(message) { $('toast').textContent=message; $('toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').hidden=true,6000); }
async function api(url,options={}) {
  const response=await fetch(`/api${url}`,{...options,headers:{'Content-Type':'application/json','X-CSRF-Token':Acceso.csrf,...options.headers},signal:AbortSignal.timeout(25000)});
  if(response.status===401){location.replace('/');throw new Error('Inicia sesión para continuar.');}
  const data=await response.json(); if(!response.ok) throw new Error(data.error || 'No se pudo completar la operación.'); return data;
}
function options(drivers,blank='Seleccionar unidad') { return `<option value="">${escapeHTML(blank)}</option>`+drivers.map(d=>`<option value="${d.id}">${escapeHTML(d.codigo || d.id)} · ${escapeHTML(d.placa || 'Sin placa')} · ${escapeHTML(d.nombre)}</option>`).join(''); }
function setOptions(element,html) { const value=element.value; element.innerHTML=html; if([...element.options].some(o=>o.value===value)) element.value=value; }
function filterServiceOptions(driverElement,target,blank) {
  const services=state.services.filter(s=>String(s.conductor_id)===driverElement.value);
  setOptions(target,`<option value="">${escapeHTML(blank)}</option>`+services.map(s=>`<option value="${s.id}">#${s.id} · ${escapeHTML(s.origen)} → ${escapeHTML(s.destino)}</option>`).join(''));
}
async function sync() {
  if(state.syncing)return; state.syncing=true; $('refreshButton').disabled=true;
  try {
    const [drivers,services,summary,people]=await Promise.all([api('/unidades'),api('/servicios'),api('/resumen'),api('/personal-conductores')]);
    state.drivers=drivers;state.people=people;renderPeople(); state.services=services; renderSummary(summary); renderServices(); renderWorkflow(); renderDrivers(); Mejoras.onSync(summary);
    setOptions($('routeDriver'),options(drivers)); setOptions($('positionDriver'),options(drivers));
    filterServiceOptions($('routeDriver'),$('routeService'),'Todos los servicios');
    filterServiceOptions($('positionDriver'),$('positionService'),'Sin servicio asociado');
    if(state.map) renderMarkers();
    $('connectionState').textContent='● Base de datos conectada'; $('lastSync').textContent=`Actualizado ${dateTime(summary.actualizado_en)}`;
    $('alert').hidden=true;
  } catch(error) {
    $('connectionState').textContent='● Sin sincronización'; $('alert').textContent=`${error.message} Los datos visibles pueden estar desactualizados. Usa Actualizar para reintentar.`; $('alert').hidden=false;
  } finally { state.syncing=false; $('refreshButton').disabled=false; }
}
function renderSummary(data) {
  const s=data.servicios,d=data.unidades;
  const icons=[['blue','<path d="M3 16V9l3-4h12l3 4v7H3Z"></path><circle cx="7" cy="17" r="2"></circle><circle cx="17" cy="17" r="2"></circle>'],['green','<circle cx="9" cy="7" r="4"></circle><path d="M2 21v-2a7 7 0 0 1 14 0v2M17 11l2 2 3-4"></path>'],['teal','<path d="M12 2v20M17 5H9a3 3 0 0 0 0 7h6a3 3 0 0 1 0 7H6"></path>'],['amber','<circle cx="12" cy="12" r="9"></circle><path d="M12 6v6l4 2"></path>'],['purple','<path d="M6 3h4l2 5-3 2a12 12 0 0 0 5 5l2-3 5 2v4a3 3 0 0 1-3 3A18 18 0 0 1 3 6a3 3 0 0 1 3-3Z"></path>']];
  $('metrics').innerHTML=[['Servicios activos',s.activos,'Pendientes, asignados y en recorrido'],['Unidades disponibles',d.disponibles,`${d.total} unidades registradas`],['Facturado hoy',money(s.facturado_hoy),'Tarifas de servicios completados hoy'],['Solicitudes hoy',s.hoy,'Solicitudes registradas en la fecha de Perú'],['Llamadas hoy',data.llamadas.hoy,'Llamadas registradas en PostgreSQL']].map(([label,value,note],i)=>`<div class="kpi-card"><div class="kpi-top"><span class="kpi-title">${label}</span><div class="kpi-icon-wrap kpi-icon-${icons[i][0]}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[i][1]}</svg></div></div><div class="kpi-value-wrap"><span class="kpi-value mono">${escapeHTML(value)}</span></div><div class="kpi-footer-tag">${escapeHTML(note)}</div></div>`).join('');
  $('operationSummary').innerHTML=`<div class="summary-line"><span>Servicios por asignar</span><strong>${s.pendientes}</strong></div><div class="summary-line"><span>Ubicación reciente (≤ 5 min)</span><strong>${d.gps_reciente}</strong></div><div class="summary-line"><span>Completados sin tarifa, histórico</span><strong>${s.sin_tarifa}</strong></div>`;
  const hours=Array.from({length:24},(_,hora)=>data.horas.find(x=>x.hora===hora)?.cantidad || 0),max=Math.max(...hours,1);
  $('hourChart').innerHTML=hours.some(Boolean)?hours.map((count,hour)=>`<div class="hour-column" title="${hour}:00 · ${count} servicios"><div class="hour-bar" style="height:${Math.max(2,count/max*140)}px"></div><span>${String(hour).padStart(2,'0')}</span></div>`).join(''):empty('Todavía no hay solicitudes registradas hoy.');
}
function serviceTable(services,editable=true) {
  if(!services.length)return empty('No hay servicios que mostrar. Registra un pedido con Nuevo servicio.');
  return `<div class="table-wrap"><table><thead><tr><th>Servicio / cliente</th><th>Recorrido solicitado</th><th>Unidad</th><th>Estado</th><th>Tarifa</th>${editable?'<th>Acciones</th>':''}</tr></thead><tbody>${services.map(s=>`<tr><td><strong>#${s.id} · ${escapeHTML(s.cliente || 'Sin cliente')}</strong><small>${dateTime(s.creado_en)} · ${escapeHTML(s.categoria)}</small><small>${escapeHTML(s.codigo)}</small></td><td>${escapeHTML(s.origen)}<small>→ ${escapeHTML(s.destino)}</small></td><td>${escapeHTML(s.placa || 'Sin asignar')}<small>${escapeHTML(s.conductor || '')}</small></td><td>${badge(s.estado)}</td><td>${money(s.tarifa)}</td>${editable?`<td><button class="secondary" data-edit="${s.id}">Gestionar</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function renderServices() {
  const search=$('serviceSearch').value.toLocaleLowerCase('es'),status=$('serviceStatus').value;
  const services=state.services.filter(s=>(!status || s.estado===status) && [s.id,s.codigo,s.cliente,s.conductor,s.placa,s.origen,s.destino].some(value=>String(value || '').toLocaleLowerCase('es').includes(search)));
  $('servicesTable').innerHTML=serviceTable(services); $('recentServices').innerHTML=serviceTable(state.services.slice(0,5),false);
}
function renderDrivers() {
  const query=$('driverSearch').value.trim().toLocaleLowerCase('es');
  const drivers=state.drivers.filter(d=>(!$('driverFilterStatus').value || d.estado===$('driverFilterStatus').value) && (!$('driverFilterCategory').value || d.categoria===$('driverFilterCategory').value) && [d.codigo,d.nombre,d.placa,d.telefono,d.vehiculo].some(v=>String(v || '').toLocaleLowerCase('es').includes(query)));
  $('driversSummary').innerHTML=[['Unidades registradas',state.drivers.length],['Disponibles',state.drivers.filter(d=>d.estado==='DISPONIBLE').length],['Ocupadas',state.drivers.filter(d=>d.estado==='OCUPADO').length]].map(([label,value])=>`<div class="connection-metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
  $('driversCount').textContent=`${drivers.length} de ${state.drivers.length} unidades`;
  $('drivers').innerHTML=drivers.length?drivers.map(d=>`<article class="card driver-card"><div class="card-heading"><span class="tag">${escapeHTML(d.codigo || `#${d.id}`)}</span>${badge(d.estado)}</div><div class="plate">${escapeHTML(d.placa || 'SIN PLACA')}</div><h3>${escapeHTML(d.vehiculo || 'Sin vehículo')}</h3><p class="unit-person">Conductor actual: <strong>${escapeHTML(d.nombre)}</strong></p><p>Categoría: ${escapeHTML(d.categoria || '')}</p><div class="muted">Teléfono: ${escapeHTML(d.telefono || 'Sin registrar')}<br>Última ubicación: ${dateTime(d.ubicacion_en)}</div><div class="driver-actions"><button class="secondary" data-unit-assign="${d.id}">${d.chofer_id?'Cambiar conductor':'Asignar conductor'}</button><button class="secondary" data-driver-edit="${d.id}">Editar unidad</button><button class="secondary" data-route="${d.id}">Ver recorrido</button><button class="secondary danger-button" data-driver-delete="${d.id}">Eliminar</button></div></article>`).join(''):empty(state.drivers.length?'No hay unidades que coincidan con los filtros.':'Registra la primera unidad para empezar a despachar.');
}
async function openDriver(id) {
  const form=$('driverForm');form.reset();$('driverId').value='';
  if(id){
    try{
      const driver=await api(`/unidades/${id}`);
      for(const name of ['codigo','placa','vehiculo','categoria'])form.elements[name].value=driver[name] || '';
      $('driverId').value=driver.id;
    }catch(error){toast(error.message);return;}
  }
  $('driverDialogTitle').textContent=id?'Editar unidad':'Registrar unidad';
  $('driverDialog').showModal();
}
async function deleteDriver(button) {
  const driver=state.drivers.find(d=>String(d.id)===button.dataset.driverDelete);if(!driver)return;
  if(!confirm(`¿Eliminar la unidad ${driver.codigo || driver.placa} (${driver.placa})? Esta acción es permanente. Solo se pueden eliminar unidades sin servicios ni ubicaciones registrados.`))return;
  button.disabled=true;
  try{await api(`/unidades/${driver.id}`,{method:'DELETE'});toast('Unidad eliminada.');await sync();}
  catch(error){toast(error.message);}finally{button.disabled=false;}
}
function showView() {
  const key=location.hash.slice(1),view=titles[key]?key:'panel-general'; state.view=view;
  document.querySelectorAll('.view').forEach(el=>{const active=el.id===`view-${view}`;el.hidden=!active;el.classList.toggle('active',active);});
  document.querySelectorAll('[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  $('viewTitle').textContent=titles[view]; $('sidebar').classList.remove('open');
  if(view==='despacho-flujo')initMap();
  if(view==='conexiones')loadConnections();
  if(view==='consola-ia')loadCalls();
}
function initMap() {
  if(!window.L){$('fleetMap').innerHTML=empty('No se pudo cargar el mapa. Revisa tu conexión a internet y vuelve a abrir el dashboard.');return;}
  if(!state.map) {
    state.map=L.map('fleetMap').setView([-8.1116,-79.0287],13);
    const tiles=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(state.map);
    tiles.on('tileerror',()=>toast('No se pudieron cargar algunas partes del mapa. Revisa tu conexión a internet.'));
    state.markers=L.layerGroup().addTo(state.map); state.route=L.layerGroup().addTo(state.map); renderMarkers();
  }
  setTimeout(()=>state.map.invalidateSize(),100);
}
function renderMarkers() {
  state.markers.clearLayers(); state.drivers.filter(d=>d.ubicacion_en && d.latitud!=null && d.longitud!=null).forEach(d=>{
    const fresh=Date.now()-new Date(d.ubicacion_en).getTime()<=300000;
    L.circleMarker([Number(d.latitud),Number(d.longitud)],{radius:8,color:'white',weight:2,fillColor:fresh?'#129ab0':'#7d8fa4',fillOpacity:1}).addTo(state.markers).bindPopup(`<strong>${escapeHTML(d.placa || d.codigo)}</strong><br>${escapeHTML(d.nombre)}<br>${dateTime(d.ubicacion_en)}<br>${fresh?'Ubicación reciente':'Ubicación anterior'}`);
  });
}
function distance(a,b) {
  const rad=x=>x*Math.PI/180,lat=rad(b.latitud-a.latitud),lng=rad(b.longitud-a.longitud);
  const h=Math.sin(lat/2)**2+Math.cos(rad(a.latitud))*Math.cos(rad(b.latitud))*Math.sin(lng/2)**2;
  return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)));
}
function invalidateRoute() { state.routeRequest++;state.points=[];state.routeMeta=null;state.route?.clearLayers();$('exportRoute').disabled=true;$('routeSummary').textContent='Filtros actualizados. Pulsa Consultar recorrido.'; }
async function loadRoute() {
  const driver=$('routeDriver').value,fecha=$('routeDate').value,service=$('routeService').value;
  if(!driver || !fecha){toast('Selecciona una unidad y fecha.');return;}
  const request=++state.routeRequest; $('loadRoute').disabled=true;
  try {
    const data=await api(`/unidades/${driver}/recorrido?fecha=${encodeURIComponent(fecha)}${service?`&servicio_id=${service}`:''}`);
    if(request!==state.routeRequest)return;
    state.points=data.puntos;state.routeMeta={driver,fecha,service};state.route?.clearLayers();$('exportRoute').disabled=!state.points.length;
    if(!data.puntos.length){$('routeSummary').textContent='No hay ubicaciones registradas para estos filtros. Registra puntos manuales o conecta la API.';return;}
    const points=data.puntos.map(p=>[Number(p.latitud),Number(p.longitud)]),km=data.puntos.reduce((sum,p,i)=>sum+(i?distance(data.puntos[i-1],p):0),0);
    const start=data.puntos[0],end=data.puntos.at(-1);
    $('routeSummary').innerHTML=`<strong>${km.toFixed(2)} km</strong>Distancia aproximada entre puntos<br>${points.length} puntos · ${data.puntos.filter(p=>p.fuente==='manual').length} manuales<br>Inicio: ${dateTime(start.registrado_en)}<br>Fin: ${dateTime(end.registrado_en)}${data.truncado?'<br>Resultado limitado a 20 000 puntos.':''}`;
    if(state.map) {
      if(points.length>1)L.polyline(points,{color:'#0b93bf',weight:4}).addTo(state.route);
      data.puntos.forEach((p,i)=>L.circleMarker(points[i],{radius:i===0 || i===points.length-1?7:4,color:i===0?'#16a085':i===points.length-1?'#e88635':'#168bb0',fillOpacity:1}).addTo(state.route).bindPopup(`${i===0?'Inicio · ':i===points.length-1?'Fin · ':''}${dateTime(p.registrado_en)}<br>Fuente: ${escapeHTML(p.fuente)}<br>${p.servicio_id?`Servicio #${p.servicio_id}`:'Sin servicio asociado'}`));
      state.map.fitBounds(L.latLngBounds(points).pad(.2),{maxZoom:16});
    }
  } catch(error){if(request===state.routeRequest){state.points=[];state.routeMeta=null;state.route?.clearLayers();$('exportRoute').disabled=true;$('routeSummary').textContent=error.message;}toast(error.message);}finally{$('loadRoute').disabled=false;}
}
function exportRoute() {
  if(!state.points.length)return;
  const features=state.points.map(p=>({type:'Feature',geometry:{type:'Point',coordinates:[Number(p.longitud),Number(p.latitud)]},properties:{id:p.id,conductor_id:p.conductor_id,servicio_id:p.servicio_id,registrado_en:p.registrado_en,fuente:p.fuente}}));
  if(state.points.length>1)features.unshift({type:'Feature',geometry:{type:'LineString',coordinates:state.points.map(p=>[Number(p.longitud),Number(p.latitud)])},properties:{descripcion:'Unión de puntos registrados; no ruta calculada por calles',...state.routeMeta}});
  const url=URL.createObjectURL(new Blob([JSON.stringify({type:'FeatureCollection',features},null,2)],{type:'application/geo+json'})),a=document.createElement('a');a.href=url;a.download=`recorrido-${state.routeMeta.driver}-${state.routeMeta.fecha}.geojson`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function loadConnections() {
  if(loadConnections.busy)return;
  loadConnections.busy=true;
  const button=$('checkConnections'),container=$('connections');
  button.disabled=true;button.textContent='Comprobando…';container.setAttribute('aria-busy','true');
  $('connectionsFeedback').textContent='Consultando la base de datos y el servicio Orión…';
  try {
    const data=await api('/conexiones');
    const verified=data.filter(c=>c.estado==='operativo').length,configured=data.filter(c=>c.estado==='configurado').length;
    $('connectionsSummary').innerHTML=[['Verificadas',verified,'Pruebas de disponibilidad correctas'],['Con credenciales',configured,'Disponibilidad externa sin verificar'],['Requieren revisión',data.filter(c=>!['operativo','configurado'].includes(c.estado)).length,'Configuración o conexión pendiente']].map(([label,value,note])=>`<div class="connection-metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
    const guides={
      PostgreSQL:{icon:'DB',category:'Datos operativos',description:'Servicios, unidades, llamadas y configuración.',steps:'Si no responde, revisa el contenedor de PostgreSQL y la configuración de base de datos en .env.'},
      'Orión':{icon:'OR',category:'Asistente',description:'Atención y respuestas mediante el asistente de reglas.',steps:'Revisa que el microservicio esté iniciado y que ORION_URL sea accesible desde el backend. Orión no asigna unidades automáticamente.'},
      'Twilio Voice':{icon:'TW',category:'Telefonía',description:'Recepción de llamadas y webhooks de voz.',steps:'Configura TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN en .env. En Twilio, apunta el webhook de voz a POST <PUBLIC_BASE_URL>/api/twilio/voice mediante HTTPS público.'},
      ElevenLabs:{icon:'EL',category:'Síntesis de voz',description:'Convierte las respuestas del asistente en audio.',steps:'Configura ELEVENLABS_API_KEY y ELEVENLABS_VOICE_ID en .env. Prueba la generación de audio desde la consola de Orión.'},
      Zello:{icon:'ZE',category:'Radio y despacho',description:'Avisos de servicio mediante un adaptador genérico.',steps:'Configura ZELLO_API_URL, ZELLO_API_TOKEN y ZELLO_CHANNEL con un proveedor autorizado. Valida su API y el envío al canal; las credenciales son compartidas y el adaptador está desactivado para empresas nuevas.'},
      'Ubicación de unidades':{icon:'GPS',category:'Seguimiento',description:'Puntos de ubicación manuales o recibidos por API.',steps:'Registra puntos desde Despacho y recorridos o conecta una fuente GPS a la API de ubicaciones. No hay seguimiento continuo sin una fuente conectada.'}
    };
    container.innerHTML=data.length?data.map(c=>{
      const guide=guides[c.nombre] || {icon:'API',category:'Integración',description:c.detalle,steps:'Consulta la configuración de esta integración con el administrador.'};
      const tone=c.estado==='operativo'?'ok':c.estado==='configurado'?'configured':c.estado==='pendiente'?'pending':c.estado==='manual / API'?'manual':'error';
      const label=c.estado==='configurado'?'Credenciales configuradas':c.estado==='manual / API'?'Manual / API':c.estado;
      return `<article class="card connection-card"><div class="connection-card-top"><span class="connection-icon">${guide.icon}</span><span class="connection-status connection-${tone}">${escapeHTML(label)}</span></div><p class="connection-category">${guide.category}</p><h3>${escapeHTML(c.nombre)}</h3><p>${escapeHTML(guide.description)}</p><div class="connection-evidence"><strong>${c.estado==='operativo'?'Comprobación correcta':c.estado==='configurado'?'Sin prueba externa':'Estado actual'}</strong><span>${escapeHTML(c.detalle)}</span></div><details><summary>Configuración y ayuda</summary><p>${escapeHTML(guide.steps)}</p><small>Los cambios en .env requieren recrear los servicios afectados. Las credenciales se gestionan en el servidor.</small></details></article>`;
    }).join(''):empty('No hay integraciones disponibles.');
    $('connectionsFeedback').textContent=`Última comprobación: ${dateTime(new Date())}. Las credenciales configuradas no garantizan que el proveedor responda.`;
  }catch(error){
    $('connectionsFeedback').textContent=`No se pudo comprobar: ${error.message} Puedes reintentar con Comprobar ahora.`;
    if(container.children.length)$('connectionsFeedback').textContent+=' Los resultados visibles corresponden a la comprobación anterior.';
  }finally{loadConnections.busy=false;button.disabled=false;button.textContent='Comprobar ahora';container.setAttribute('aria-busy','false');}
}
function editService(id) {
  const service=state.services.find(s=>s.id===Number(id));if(!service)return;
  $('editServiceId').value=service.id;$('editServiceInfo').textContent=`#${service.id} · ${service.origen} → ${service.destino}`;
  $('editDriver').innerHTML=options(state.drivers.filter(d=>(d.categoria===service.categoria && d.estado==='DISPONIBLE' && d.chofer_id && d.conductor_activo) || d.id===service.conductor_id),'Sin asignar');$('editDriver').value=service.conductor_id || '';
  $('editDriver').disabled=['COMPLETADO','CANCELADO'].includes(service.estado);
  $('editStatus').innerHTML=[service.estado,...(transitions[service.estado] || [])].map(status=>`<option>${status}</option>`).join('');$('editFare').value=service.tarifa ?? '';$('editDialog').showModal();
}
function openPosition(driver) {
  if(!state.drivers.length){toast('Registra primero una unidad.');return;}
  if(driver)$('positionDriver').value=driver;
  filterServiceOptions($('positionDriver'),$('positionService'),'Sin servicio asociado');
  $('positionTime').value=peruLocal();$('positionTime').max=peruLocal();$('positionDialog').showModal();
}
function submitForm(form,handler) {
  form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector(':scope > button:last-child');button.disabled=true;
    try { await handler(); }catch(error){toast(error.message);}finally{button.disabled=false;}
  });
}
function restartTimer() {clearInterval(state.timer);state.timer=setInterval(()=>{if(!document.hidden)sync();},(state.config?.intervalo_segundos || 30)*1000);}
async function init() {
  try { if(!await Acceso.dashboard())return; } catch(error) { toast(error.message); return; }
  $('routeDate').value=peruDay(); $('routeDate').max=peruDay();
  window.addEventListener('hashchange',showView);
  $('menuButton').onclick=()=>$('sidebar').classList.toggle('open');
  document.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-close'))button.closest('dialog').close();
    if(button.dataset.go)location.hash=button.dataset.go;
    if(button.dataset.edit)editService(button.dataset.edit);
    if(button.dataset.driverEdit)openDriver(button.dataset.driverEdit);
    if(button.dataset.driverDelete)deleteDriver(button);
    if(button.dataset.route){location.hash='despacho-flujo';$('routeDriver').value=button.dataset.route;filterServiceOptions($('routeDriver'),$('routeService'),'Todos los servicios');invalidateRoute();loadRoute();}
  });
  $('newServiceButton').onclick=()=>$('serviceDialog').showModal();$('newDriverButton').onclick=()=>openDriver();
  $('driverSearch').oninput=renderDrivers;$('driverFilterStatus').onchange=renderDrivers;$('driverFilterCategory').onchange=renderDrivers;
  $('checkConnections').onclick=loadConnections;initFleet();
  $('openPosition').onclick=()=>openPosition($('routeDriver').value);$('refreshButton').onclick=async()=>{await sync();if(state.view==='conexiones')loadConnections();if(state.view==='consola-ia')loadCalls();};
  $('serviceSearch').oninput=renderServices;$('serviceStatus').onchange=renderServices;
  if($('globalSearchInput'))$('globalSearchInput').addEventListener('input',()=>{$('serviceSearch').value=$('globalSearchInput').value;renderServices();if($('globalSearchInput').value)location.hash='despacho-flujo';});
  $('editDriver').onchange=()=>{if($('editDriver').value && $('editStatus').value==='SOLICITADO')$('editStatus').value='ASIGNADO';};
  $('routeDriver').onchange=()=>{filterServiceOptions($('routeDriver'),$('routeService'),'Todos los servicios');invalidateRoute();};$('routeDate').onchange=invalidateRoute;$('routeService').onchange=invalidateRoute;
  $('positionDriver').onchange=()=>filterServiceOptions($('positionDriver'),$('positionService'),'Sin servicio asociado');
  $('loadRoute').onclick=loadRoute;$('exportRoute').onclick=exportRoute;$('centerMap').onclick=()=>state.map?.setView([-8.1116,-79.0287],13);
  submitForm($('serviceForm'),async()=>{const result=await api('/servicios',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData($('serviceForm'))))});$('serviceDialog').close();$('serviceForm').reset();toast(result.zello.enviado?'Servicio guardado y aviso enviado.':'Servicio guardado. Aviso Zello pendiente; asigna la unidad desde despacho.');await sync();location.hash='despacho-flujo';});
  submitForm($('driverForm'),async()=>{const id=$('driverId').value;await api(id?`/unidades/${id}`:'/unidades',{method:id?'PUT':'POST',body:JSON.stringify(Object.fromEntries(new FormData($('driverForm'))))});$('driverDialog').close();$('driverForm').reset();toast(id?'Unidad actualizada.':'Unidad registrada.');await sync();});
  submitForm($('editForm'),async()=>{await api(`/servicios/${$('editServiceId').value}`,{method:'PATCH',body:JSON.stringify({estado:$('editStatus').value,conductor_id:$('editDriver').value?Number($('editDriver').value):null,tarifa:$('editFare').value===''?null:Number($('editFare').value)})});$('editDialog').close();toast('Servicio actualizado.');await sync();});
  submitForm($('positionForm'),async()=>{await api(`/unidades/${$('positionDriver').value}/posiciones`,{method:'POST',body:JSON.stringify({latitud:Number($('positionLat').value),longitud:Number($('positionLng').value),registrado_en:`${$('positionTime').value}:00-05:00`,servicio_id:$('positionService').value?Number($('positionService').value):null,fuente:'manual'})});$('positionDialog').close();toast('Ubicación guardada.');await sync();if($('routeDriver').value)await loadRoute();});
  submitForm($('settingsForm'),async()=>{state.config=await api('/configuracion',{method:'PUT',body:JSON.stringify({empresa:$('companyName').value,intervalo_segundos:Number($('refreshSeconds').value)})});Acceso.companyName(state.config.empresa);restartTimer();toast('Configuración guardada en PostgreSQL.');});
  const updateClock=()=>{$('clock').textContent=new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',hour:'2-digit',minute:'2-digit'}).format(new Date())+' · PE';};updateClock();setInterval(updateClock,60000);
  Mejoras.init();
  showView();
  try{state.config=await api('/configuracion');$('companyName').value=state.config.empresa;$('refreshSeconds').value=state.config.intervalo_segundos;}catch(error){toast(error.message);}
  await sync();restartTimer();
}
document.addEventListener('DOMContentLoaded',init);
