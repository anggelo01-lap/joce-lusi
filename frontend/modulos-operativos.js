'use strict';
const moduleEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const moduleTable = (head, rows) => `<div style="overflow-x:auto"><table class="clean-table"><thead><tr>${head.map(h=>`<th>${moduleEscape(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map(row=>`<tr>${row.map(v=>`<td>${moduleEscape(v)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${head.length}">No hay registros.</td></tr>`}</tbody></table></div>`;
function modulePanel(view, title, html) {
  document.getElementById(`view-${view}`).innerHTML = `<div class="module-container-card"><h3>${title}</h3>${html}</div>`;
}
async function refreshOperationalModules() {
  const outcomes = await Promise.allSettled([api('/llamadas'), api('/auditoria'), api('/conexiones')]);
  const calls = outcomes[0], audit = outcomes[1], connections = outcomes[2];
  modulePanel('recepcion-llamadas', 'Registro de llamadas', calls.status === 'fulfilled' ?
    '<p>Registros recibidos por el sistema. El modo memoria incluye ejemplos; no confirma una conexión telefónica activa.</p>' + moduleTable(['Fecha','Teléfono','Estado','Duración (s)','Transcripción'], calls.value.map(c=>[c.inicio,c.telefono_origen,c.estado,c.duracion_segundos,c.transcripcion])) : '<p role="alert">No se pudieron cargar las llamadas.</p>');
  if (audit.status === 'fulfilled') document.getElementById('tbodyAuditoria').innerHTML = audit.value.map(a=>`<tr>${[a.creado_en,a.usuario,a.modulo,a.accion,a.estado].map(v=>`<td>${moduleEscape(v)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="5">No hay eventos registrados.</td></tr>';
  else document.getElementById('tbodyAuditoria').innerHTML = '<tr><td colspan="5">No se pudo cargar la auditoría.</td></tr>';
  modulePanel('configuraciones','Estado de conexiones', connections.status === 'fulfilled' ? '<p>Consulta de configuración. Las credenciales se administran en el servidor.</p>'+moduleTable(['Servicio','Estado','Detalle'],connections.value.map(c=>[c.nombre,c.estado,c.detalle])) : '<p role="alert">No se pudo consultar el estado de conexiones.</p>');
  modulePanel('historial-reportes','Historial de servicios', '<p>Exporta los registros disponibles en esta sesión.</p><button class="btn-secondary-white" id="exportServices">Descargar CSV</button>'+moduleTable(['Código','Cliente','Origen','Destino','Estado','Tarifa'],appState.servicios.map(s=>[s.codigo,s.cliente,s.origen,s.destino,s.estado,s.tarifa])));
  document.getElementById('exportServices').onclick = exportOperationalServices;
  const result = PlatinumAnalitica.analyze(appState.servicios, [], {days:30});
  modulePanel('analisis-predictivo','Proyección de demanda', '<p>Media móvil local de siete días sobre los registros de los últimos 30 días. No utiliza Azure AI.</p>' + (result.forecast.available ? moduleTable(['Fecha','Servicios estimados'],result.prediction.map(p=>[p.date,p.count])) : '<p>Historial insuficiente: se necesitan registros que cubran al menos siete días. No se genera una estimación.</p>'));
  const pending = appState.servicios.filter(s=>!['COMPLETADO','CANCELADO'].includes(PlatinumAnalitica.status(s.estado)));
  modulePanel('asignacion-servicios','Asignación de servicios', '<p>Asignación manual en memoria. No envía mensajes por Zello ni reserva unidades en un proveedor externo.</p>'+moduleTable(['Código','Origen','Destino','Unidad','Estado'],pending.map(s=>[s.codigo,s.origen,s.destino,s.unidad_codigo || 'Sin asignar',s.estado]))+'<p>Selecciona una solicitud para editar su unidad y estado.</p>'+pending.map(s=>`<button class="btn-secondary-white" data-edit-service="${Number(s.id)}">${moduleEscape(s.codigo)}</button>`).join(''));
  document.querySelectorAll('[data-edit-service]').forEach(button=>button.onclick=()=>abrirModalEditarSolicitud(Number(button.dataset.editService)));
}
function exportOperationalServices() {
  const cell = value => '"'+(/^[=+@\-\t\r\n]/.test(String(value??'')) ? "'" : '')+String(value??'').replaceAll('"','""')+'"';
  const rows = [['Código','Cliente','Origen','Destino','Estado','Tarifa'], ...appState.servicios.map(s=>[s.codigo,s.cliente,s.origen,s.destino,s.estado,s.tarifa])];
  const url = URL.createObjectURL(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href=url; link.download='servicios-platinumvip.csv'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function registerOperationalControls() {
  const open = () => document.getElementById('modalRegistrarUnidad').classList.add('open');
  const close = () => document.getElementById('modalRegistrarUnidad').classList.remove('open');
  document.getElementById('btnNuevaUnidadModal').onclick=open;
  document.getElementById('btnCloseUnitModal').onclick=close;
  document.getElementById('btnCancelUnit').onclick=close;
  document.getElementById('formCrearUnidad').onsubmit=async event=>{
    event.preventDefault();
    try {
      await api('/conductores',{method:'POST',body:JSON.stringify({codigo:$('newUnitCodigo').value,nombre:$('newUnitChofer').value,telefono:$('newUnitTelefono').value,placa:$('newUnitPlaca').value,vehiculo:$('newUnitVehiculo').value})});
      close(); event.target.reset(); await initApp(); showToast('Unidad registrada.');
    } catch(error) {showToast(error.message);}
  };
  for (const [id, endpoint, fields] of [
    ['btnNuevoPasajeroModal','/pasajeros',['nombre','telefono']],
    ['btnNuevoUsuarioModal','/usuarios',['nombre','email']]
  ]) document.getElementById(id).onclick=()=>{
    const dialog=document.createElement('dialog');
    dialog.innerHTML=`<form><h3>${endpoint === '/pasajeros' ? 'Registrar pasajero' : 'Registrar personal de demostración'}</h3>${endpoint === '/usuarios' ? '<p>Este directorio en memoria no crea credenciales de inicio de sesión.</p>' : ''}${fields.map(field=>`<label>${field}<input class="form-input" name="${field}" type="${field==='email'?'email':'text'}" required maxlength="120"></label>`).join('')}<button type="submit" class="btn-primary-blue">Guardar</button><button type="button">Cancelar</button><p role="alert"></p></form>`;
    document.body.append(dialog);dialog.querySelector('[type=button]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();
    dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=dialog.querySelector('[type=submit]');button.disabled=true;try{await api(endpoint,{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.target)))});dialog.close();await initApp();}catch(error){dialog.querySelector('[role=alert]').textContent=error.message;button.disabled=false;}};
    dialog.showModal();
  };
  document.getElementById('avatarTopBtn').onclick=()=>switchView('usuarios-roles');
  document.getElementById('bellBtn').onclick=()=>showToast('No hay un servicio de notificaciones conectado.');
}
document.addEventListener('DOMContentLoaded',registerOperationalControls);
