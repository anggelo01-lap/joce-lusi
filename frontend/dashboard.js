// ============================================================================
// PLATINUMVIP — CENTRO DE CONTROL OPERATIVO
// Control de Módulos, Métricas en Vivo y CRUD Completo para el Administrador
// Trujillo, Perú · 2026
// ============================================================================

'use strict';

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Estado de la Aplicación
const appState = {
  activeView: 'panel-principal',
  resumen: {
    llamadas_hoy: 0,
    solicitudes_activas: 0,
    unidades_disponibles: 0,
    servicios_completados: 0,
    ingresos_hoy: 0
  },
  servicios: [],
  conductores: [],
  pasajeros: [],
  usuarios: [],
  map: null
};

// Formato de Moneda
const money = val => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(Number(val) || 0);

// Notificaciones Toast
function showToast(msg) {
  const t = $('toastNotice');
  if (!t) return;
  $('toastMsg').textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3800);
}

// Fetch Helper
async function api(url, options = {}) {
  try {
    const res = await fetch(`/api${url}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.dashboardCsrf || '', ...options.headers }
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const error = new Error(err.error || `HTTP ${res.status}`);
      error.status = res.status;
      throw error;
    }
    return await res.json();
  } catch (error) {
    console.warn(`API ${url}:`, error.message);
    throw error;
  }
}

// ============================================================================
// 1. RELOJ EN TIEMPO REAL (21:32:18 (Trujillo))
// ============================================================================
function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour12: false });
  const el = $('trujilloClock');
  if (el) el.textContent = `${timeStr} (Trujillo)`;
}
setInterval(updateClock, 1000);
updateClock();

// ============================================================================
// 2. NAVEGACIÓN ENTRE TODOS LOS MÓDULOS
// ============================================================================
const viewMeta = {
  'panel-principal': 'Panel de Control Operativo',
  'recepcion-llamadas': 'Recepción de llamadas',
  'solicitudes': 'Solicitudes',
  'conductores-unidades': 'Conductores y unidades',
  'asignacion-servicios': 'Asignación de servicios',
  'mapa-servicios': 'Mapa de servicios',
  'pasajeros': 'Historial de pasajeros',
  'historial-reportes': 'Historial y reportes',
  'analisis-predictivo': 'Análisis predictivo',
  'usuarios-roles': 'Usuarios y roles',
  'configuraciones': 'Configuraciones',
  'auditoria-sistema': 'Auditoría del sistema'
};

function switchView(viewId) {
  if (!viewMeta[viewId]) return;
  appState.activeView = viewId;

  // Actualizar enlaces del sidebar
  $$('.menu-link').forEach(link => {
    if (link.dataset.view === viewId) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });

  // Actualizar secciones visibles
  $$('.view-section').forEach(sec => {
    if (sec.id === `view-${viewId}`) {
      sec.classList.add('active');
    } else {
      sec.classList.remove('active');
    }
  });

  // Título en la barra superior
  const titleEl = $('viewHeaderTitle');
  if (titleEl) titleEl.textContent = viewMeta[viewId];

  // Si es mapa, inicializar o redimensionar
  if (viewId === 'mapa-servicios') {
    setTimeout(ensureServiceMap, 120);
  }
}

// Asignar clics a los enlaces del sidebar
$$('.menu-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const v = link.dataset.view;
    location.hash = v;
    switchView(v);
  });
});

window.addEventListener('hashchange', () => {
  const hash = location.hash.replace('#', '');
  if (hash && viewMeta[hash]) switchView(hash);
});

// Pestañas de demanda (7 días, 30 días, 90 días)
$$('.time-tab-navy, .time-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.time-tab-navy, .time-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderOperationalCharts(Number(btn.textContent.match(/\d+/)?.[0]) || 7);
  });
});

// ============================================================================
// 3. MAPA SATELITAL DE TRUJILLO
// ============================================================================
function initMapIfNeeded() {
  if (appState.map) {
    appState.map.invalidateSize();
    return;
  }

  const container = $('mapContainer');
  if (!container) return;

  if (typeof L === 'undefined') { container.textContent = 'No se pudo cargar el mapa. Comprueba tu conexi?n.'; return; }
  const trujilloCoords = [-8.1116, -79.0287];
  appState.map = L.map('mapContainer').setView(trujilloCoords, 14);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap · PlatinumVIP'
  }).addTo(appState.map);

  const unidades = appState.conductores.filter(u => Number.isFinite(Number(u.latitud)) && Number.isFinite(Number(u.longitud)) && u.latitud != null && u.longitud != null).map(u => ({...u,lat:Number(u.latitud),lng:Number(u.longitud),estado:u.estado === 'DISPONIBLE' ? 'Disponible' : u.estado}));

  unidades.forEach(u => {
    const isDisp = u.estado === 'Disponible';
    const color = isDisp ? '#22c55e' : '#f59e0b';

    const customIcon = L.divIcon({
      html: `<div style="background:${color}; color:#fff; border-radius:50%; width:30px; height:30px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:10.5px; border:2px solid #fff; box-shadow:0 2px 5px rgba(0,0,0,0.25);">${moduleEscape(u.codigo)}</div>`,
      className: 'pin-fleet',
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    L.marker([u.lat, u.lng], { icon: customIcon })
      .addTo(appState.map)
      .bindPopup(`<strong>${moduleEscape(u.codigo)} · ${moduleEscape(u.nombre)}</strong><br>Estado: ${moduleEscape(u.estado)}`);
  });
}

// ============================================================================
// 4. GESTIÓN CRUD DE SOLICITUDES (CREATE, READ, UPDATE, DELETE)
// ============================================================================

// Helper clase de estado
function getStatusClass(st) {
  const norm = String(st || '').toLowerCase().replace(/\s+/g, '_');
  if (norm.includes('asig')) return 'status-asignado';
  if (norm.includes('curso')) return 'status-en_curso';
  if (norm.includes('comp')) return 'status-completado';
  if (norm.includes('canc')) return 'status-cancelado';
  return 'status-asignado';
}

// Renderizar tabla en Panel Principal con botones CRUD
function renderTablaUltimasSolicitudes() {
  const tbody = $('tablaUltimasSolicitudesDashboard');
  if (!tbody) return;

  tbody.innerHTML = appState.servicios.slice(0, 5).map(s => `
    <tr>
      <td><strong>${moduleEscape(s.codigo)}</strong></td>
      <td>${moduleEscape(s.cliente)}</td>
      <td>${moduleEscape(s.origen)}</td>
      <td>${moduleEscape(s.destino)}</td>
      <td>${moduleEscape(s.unidad_codigo || '—')}</td>
      <td><span class="status-pill ${getStatusClass(s.estado)}">${moduleEscape(s.estado)}</span></td>
      <td style="text-align:right;">
        <div class="crud-actions-group" style="justify-content:flex-end;">
          <button class="btn-crud-action btn-edit" title="Editar (CRUD)" onclick="abrirModalEditarSolicitud(${s.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-crud-action btn-delete" title="Eliminar (CRUD)" onclick="eliminarSolicitud(${s.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Renderizar tabla en Módulo Solicitudes con CRUD completo
function renderTablaSolicitudesModulo() {
  const tbody = $('tbodySolicitudesFull');
  if (!tbody) return;

  tbody.innerHTML = appState.servicios.map(s => `
    <tr>
      <td><strong>${moduleEscape(s.codigo)}</strong></td>
      <td>${moduleEscape(s.cliente)}</td>
      <td>${s.telefono_cliente || '—'}</td>
      <td>${moduleEscape(s.origen)}</td>
      <td>${moduleEscape(s.destino)}</td>
      <td><strong>${moduleEscape(s.unidad_codigo || '—')}</strong></td>
      <td><span class="status-pill ${getStatusClass(s.estado)}">${moduleEscape(s.estado)}</span></td>
      <td><strong>${money(s.tarifa)}</strong></td>
      <td style="text-align:right;">
        <div class="crud-actions-group" style="justify-content:flex-end;">
          <button class="btn-crud-action btn-edit" title="Editar Solicitud" onclick="abrirModalEditarSolicitud(${s.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn-crud-action btn-delete" title="Eliminar Solicitud" onclick="eliminarSolicitud(${s.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

// Actualizar números de KPIs
function updateKpis() {
  $('kpiNumLlamadas').textContent = appState.resumen.llamadas_hoy;
  $('kpiNumSolicitudes').textContent = appState.resumen.solicitudes_activas;
  $('kpiNumUnidades').textContent = appState.resumen.unidades_disponibles;
  $('kpiNumCompletados').textContent = appState.resumen.servicios_completados;
  $('kpiNumIngresos').textContent = money(appState.resumen.ingresos_hoy);
}

// CRUD: ABRIR MODAL EDITAR (UPDATE)
window.abrirModalEditarSolicitud = (id) => {
  const s = appState.servicios.find(x => x.id === id);
  if (!s) return;

  $('editSolId').value = s.id;
  $('editSolCodigo').value = s.codigo;
  $('editSolNombre').value = s.cliente;
  $('editSolOrigen').value = s.origen;
  $('editSolDestino').value = s.destino;
  $('editSolUnidad').innerHTML = '<option value="">Sin asignar</option>' + appState.conductores.map(d=>`<option value="${moduleEscape(d.codigo)}">${moduleEscape(d.codigo)} - ${moduleEscape(d.nombre)}</option>`).join('');
  $('editSolUnidad').value = s.unidad_codigo || '';
  $('editSolUnidad').disabled = true;
  $('editSolUnidad').title = 'La unidad se selecciona desde Asignaci?n de servicios';
  $('editSolEstado').value = s.estado;
  $('editSolTarifa').value = s.tarifa ?? 0;

  $('modalEditarSolicitud').classList.add('open');
};

// CRUD: GUARDAR EDICIÓN (UPDATE)
$('formEditarSolicitud').addEventListener('submit', async e => {
  e.preventDefault();
  const id = Number($('editSolId').value);
  const body = {
    cliente: $('editSolNombre').value,
    origen: $('editSolOrigen').value,
    destino: $('editSolDestino').value,
    unidad_codigo: $('editSolUnidad').value,
    estado: $('editSolEstado').value,
    tarifa: Number($('editSolTarifa').value)
  };

  try {
    const updated = await api(`/servicios/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });

    const idx = appState.servicios.findIndex(s => s.id === id);
    if (idx !== -1) appState.servicios[idx] = updated;

    await initApp();
    $('modalEditarSolicitud').classList.remove('open');
    showToast(`✓ Solicitud ${updated.codigo} actualizada con éxito (CRUD)`);
  } catch (err) {
    showToast(`Error al actualizar: ${err.message}`);
  }
});

// CRUD: ELIMINAR (DELETE)
window.eliminarSolicitud = async (id) => {
  const s = appState.servicios.find(x => x.id === id);
  const cod = s ? s.codigo : `ID #${id}`;

  if (!confirm(`¿Eliminar definitivamente la solicitud ${cod}?`)) return;

  try {
    await api(`/servicios/${id}`, { method: 'DELETE' });
    await initApp();
    showToast(`✓ Solicitud ${cod} eliminada (CRUD)`);
  } catch (err) {
    showToast(`Error al eliminar: ${err.message}`);
  }
};

// CRUD: CREAR NUEVA SOLICITUD (CREATE)
$('formCrearSolicitud').addEventListener('submit', async e => {
  e.preventDefault();
  const body = {
    cliente: $('solNombre').value,
    telefono_cliente: $('solTelefono').value,
    origen: $('solOrigen').value,
    destino: $('solDestino').value,
    unidad_codigo: '',
    estado: 'Solicitado',
    tarifa: Number($('solTarifa').value)
  };

  try {
    const nuevo = await api('/servicios', {
      method: 'POST',
      body: JSON.stringify(body)
    });

    await initApp();
    $('modalNuevaSolicitud').classList.remove('open');
    $('formCrearSolicitud').reset();
    showToast(`✓ Nueva solicitud ${nuevo.codigo} registrada (CRUD)`);
  } catch (err) {
    showToast(`Error al crear: ${err.message}`);
  }
});

// Botones de Modales
$('btnNuevaSolicitudQuick').addEventListener('click', () => $('modalNuevaSolicitud').classList.add('open'));
if ($('btnNuevaSolicitudModal')) $('btnNuevaSolicitudModal').addEventListener('click', () => $('modalNuevaSolicitud').classList.add('open'));
$('btnCloseSolModal').addEventListener('click', () => $('modalNuevaSolicitud').classList.remove('open'));
$('btnCancelSol').addEventListener('click', () => $('modalNuevaSolicitud').classList.remove('open'));

$('btnCloseEditSolModal').addEventListener('click', () => $('modalEditarSolicitud').classList.remove('open'));
$('btnCancelEditSol').addEventListener('click', () => $('modalEditarSolicitud').classList.remove('open'));

// ============================================================================
// 5. CRUD DE CONDUCTORES, PASAJEROS Y USUARIOS
// ============================================================================
function renderConductoresCRUD() {
  const tbody = $('tbodyConductores');
  if (!tbody) return;
  tbody.innerHTML = appState.conductores.map(c => `
    <tr>
      <td><strong>${moduleEscape(c.codigo)}</strong></td>
      <td>${moduleEscape(c.nombre)}</td>
      <td>${moduleEscape(c.telefono)}</td>
      <td><code>${moduleEscape(c.placa)}</code></td>
      <td>${moduleEscape(c.vehiculo)}</td>
      <td><span class="status-pill ${c.estado === 'DISPONIBLE' ? 'status-completado' : 'status-en_curso'}">${moduleEscape(c.estado)}</span></td>
      <td style="text-align:right;">
        <div class="crud-actions-group" style="justify-content:flex-end;">
          <button class="btn-crud-action btn-delete" title="Eliminar Unidad" onclick="eliminarUnidad(${c.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.eliminarUnidad = async (id) => {
  if (!confirm('¿Eliminar esta unidad de la flota?')) return;
  try {
    await api(`/conductores/${id}`, { method: 'DELETE' });
    appState.conductores = appState.conductores.filter(c => c.id !== id);
    renderConductoresCRUD();
    showToast('Unidad eliminada de la flota');
  } catch (err) {
    showToast(err.message);
  }
};

function renderPasajerosCRUD() {
  const tbody = $('tbodyPasajeros');
  if (!tbody) return;
  tbody.innerHTML = appState.pasajeros.map(p => `
    <tr>
      <td><strong>${moduleEscape(p.nombre)}</strong></td>
      <td>${moduleEscape(p.telefono)}</td>
      <td><span class="status-pill status-asignado">${moduleEscape(p.tipo)}</span></td>
      <td>${appState.servicios.filter(s=>s.cliente_id===p.id || (String(s.telefono_cliente || '').replace(/\D/g,'') && String(s.telefono_cliente || '').replace(/\D/g,'') === String(p.telefono || '').replace(/\D/g,''))).length} servicios</td>
      <td>${moduleEscape(p.notas || '—')}</td>
      <td style="text-align:right;">
        <div class="crud-actions-group" style="justify-content:flex-end;">
          <button class="btn-crud-action btn-delete" title="Dar de baja pasajero" onclick="eliminarPasajero(${p.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.eliminarPasajero = async (id) => {
  if (!confirm('¿Eliminar este pasajero del directorio?')) return;
  try {
    await api(`/pasajeros/${id}`, { method: 'DELETE' });
    appState.pasajeros = appState.pasajeros.filter(p => p.id !== id);
    renderPasajerosCRUD();
    showToast('Pasajero eliminado del directorio');
  } catch (err) {
    showToast(err.message);
  }
};

function renderUsuariosCRUD() {
  const tbody = $('tbodyUsuarios');
  if (!tbody) return;
  tbody.innerHTML = appState.usuarios.map(u => `
    <tr>
      <td><strong>${moduleEscape(u.nombre)}</strong></td>
      <td>${moduleEscape(u.email)}</td>
      <td>${moduleEscape(u.rol)}</td>
      <td><span class="status-pill status-completado">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td style="text-align:right;">
        <div class="crud-actions-group" style="justify-content:flex-end;">
          <button class="btn-crud-action btn-delete" title="Eliminar cuenta" onclick="eliminarUsuario(${u.id})">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.eliminarUsuario = async (id) => {
  if (!confirm('¿Eliminar esta cuenta de usuario?')) return;
  try {
    await api(`/acceso/usuarios/${id}`, { method: 'DELETE' });
    appState.usuarios = appState.usuarios.filter(u => u.id !== id);
    renderUsuariosCRUD();
    showToast('Usuario eliminado');
  } catch (err) {
    showToast(err.message);
  }
};

// ============================================================================
// 6. CARGA INICIAL Y SINCRONIZACIÓN
// ============================================================================
async function initApp() {
  try {
    const {data,errors}=await loadDashboardData(api);
    const {servicios,conductores,pasajeros,usuarios,resumen,health}=data;
    appState.loadErrors=errors;
    appState.source=health?.postgres_activo===true || health?.database===true || health?.database==='PostgreSQL' ? 'PostgreSQL' : (resumen?.fuente==='memoria' ? 'memoria' : 'backend');

    appState.servicios = servicios;
    appState.conductores = conductores;
    appState.pasajeros = pasajeros;
    appState.usuarios = usuarios;

    if (resumen && resumen.servicios) {
      appState.resumen.llamadas_hoy = resumen.llamadas?.hoy ?? 0;
      appState.resumen.solicitudes_activas = resumen.servicios.activos ?? 0;
      appState.resumen.unidades_disponibles = resumen.unidades?.disponibles ?? 0;
      appState.resumen.servicios_completados = resumen.servicios.completados_hoy ?? 0;
      appState.resumen.ingresos_hoy = resumen.servicios.facturado_hoy ?? 0;
    }

    updateKpis();
    renderTablaUltimasSolicitudes();
    renderTablaSolicitudesModulo();
    renderConductoresCRUD();
    renderPasajerosCRUD();
    renderUsuariosCRUD();
    renderOperationalCharts();
    await refreshOperationalModules();
    await renderWorkflowModules();
    if (appState.activeView === 'mapa-servicios') ensureServiceMap();
    const notice = $('dataSourceNotice');
    const statusLabel=document.querySelector('.status-online-line span:last-child');
    if(statusLabel)statusLabel.textContent=appState.source==='PostgreSQL'?'PostgreSQL conectado':appState.source==='memoria'?'Datos en memoria':'Conectado al backend';
    const unavailable=Object.keys(errors);
    if(notice)notice.textContent=(appState.source==='memoria'?'Datos de ejemplo en memoria. ':'Datos del servidor. ')+(unavailable.length?'No se pudieron cargar: '+unavailable.join(', ')+'. Los demás módulos siguen disponibles.':'Actualizado: '+new Date().toLocaleTimeString('es-PE',{timeZone:'America/Lima'}));
    if(errors.resumen)document.querySelectorAll('.kpi-big-number').forEach(el=>el.textContent='\u2014');
    if(errors.pasajeros){const table=$('tbodyPasajeros');if(table)table.innerHTML='<tr><td colspan="6">El backend instalado no ofrece el directorio de pasajeros. No se han cargado registros.</td></tr>';}

  } catch (err) {
    if(err.status===401){location.replace('/');return;}
    showToast('No se pudieron cargar los datos: ' + err.message);
    $('dataSourceNotice').textContent = 'Error de carga. Recarga la página para volver a intentar.';
    document.querySelectorAll('.kpi-big-number').forEach(el => el.textContent = '—');
    renderTablaUltimasSolicitudes();
  }
}

// Cierre de sesión
if ($('userProfileBtn')) {
  $('userProfileBtn').addEventListener('click', async () => {
    if (confirm('¿Cerrar sesión de Administrador?')) {
      try { await api('/acceso/logout', {method:'POST'}); } catch (error) {showToast(error.message); return;}
      location.href = '/';
    }
  });
}

// Inicialización en DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const hash = location.hash.replace('#', '');
  if (hash && viewMeta[hash]) {
    switchView(hash);
  } else {
    switchView('panel-principal');
  }
  api('/acceso/yo').then(session => {
    window.dashboardCsrf = session.csrf;
    appState.session=session;
    document.querySelector('.user-session-state').textContent=session.usuario.email;
    document.querySelector('.user-avatar-badge').textContent=session.usuario.nombre.split(/\s+/).map(n=>n[0]).slice(0,2).join('').toUpperCase();
    document.querySelector('.user-display-name').textContent = session.usuario.nombre;
    return initApp();
  }).catch(error => {if(error.status===401)location.replace('/');else showToast(error.message);});
});
