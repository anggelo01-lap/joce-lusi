'use strict';
/* Mejoras de interacción: Panel general, Flujo de trabajo y Operadora IA.
   Usa los helpers globales de dashboard.js ($, api, state, toast, badge, money, dateTime, escapeHTML, transitions). */
const Mejoras = (() => {
  const esc = v => escapeHTML(v);
  const LABEL = { SOLICITADO: 'Solicitado', ASIGNADO: 'Asignado', EN_RECOJO: 'En recojo', EN_CURSO: 'En curso', COMPLETADO: 'Completado', CANCELADO: 'Cancelado' };
  const NEXT = { SOLICITADO: 'ASIGNADO', ASIGNADO: 'EN_RECOJO', EN_RECOJO: 'EN_CURSO', EN_CURSO: 'COMPLETADO' };
  const NEXT_TEXT = { ASIGNADO: 'Asignar unidad', EN_RECOJO: 'Unidad en camino', EN_CURSO: 'Pasajero a bordo', COMPLETADO: 'Completar servicio' };
  const EMPTY_HINT = { SOLICITADO: 'Sin pedidos por asignar', ASIGNADO: 'Arrastra aquí un pedido con unidad', EN_RECOJO: 'Nadie en camino al recojo', EN_CURSO: 'Sin viajes en curso', COMPLETADO: 'Aún no hay completados', CANCELADO: 'Sin cancelaciones' };
  const STEPS = ['SOLICITADO', 'ASIGNADO', 'EN_RECOJO', 'EN_CURSO', 'COMPLETADO'];
  const TERMINAL_LIMIT = 6;
  const M = { busy: false, dragId: null, stats: null, summary: null, calls: [], selectedCall: null };

  const age = iso => {
    const m = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
    if (m < 60) return `${m} min`;
    if (m < 1440) return `${Math.floor(m / 60)} h ${m % 60} min`;
    return `${Math.floor(m / 1440)} d`;
  };
  const ageMin = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const shortDay = iso => new Intl.DateTimeFormat('es-PE', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(new Date(iso));
  const goto = (view, filter) => {
    if (filter != null) { $('serviceStatus').value = filter; $('serviceSearch').value = ''; if ($('globalSearchInput')) $('globalSearchInput').value = ''; renderServices(); }
    location.hash = view;
  };

  /* =============== PANEL GENERAL =============== */
  function attention(s, d) {
    const items = [];
    if (s.esperando_mucho > 0) items.push(['danger', `${s.esperando_mucho} pedido(s) llevan más de 5 min sin unidad`, 'Asignar ahora', () => goto('flujo-trabajo')]);
    else if (s.pendientes > 0) items.push(['warn', `${s.pendientes} pedido(s) por asignar`, 'Ir al flujo', () => goto('flujo-trabajo')]);
    if (d.total > 0 && d.disponibles === 0) items.push(['danger', 'No hay unidades disponibles', 'Ver unidades', () => goto('unidades')]);
    if (d.total === 0) items.push(['warn', 'Aún no hay unidades registradas', 'Registrar unidad', () => { goto('unidades'); $('driverDialog').showModal(); }]);
    if (s.sin_tarifa > 0) items.push(['info', `${s.sin_tarifa} completado(s) sin tarifa registrada`, 'Revisar', () => goto('despacho-flujo', 'COMPLETADO')]);
    if (!items.length) items.push(['ok', 'Operación al día: sin pedidos pendientes ni alertas', null, null]);
    M.attentionActions = items.map(i => i[3]);
    $('attention').innerHTML = items.map((i, n) => `<div class="attn attn-${i[0]}"><span class="attn-dot"></span><span>${esc(i[1])}</span>${i[2] ? `<button class="secondary" data-attn="${n}" type="button">${esc(i[2])}</button>` : ''}</div>`).join('');
  }

  function bars(rows, { color = '#30a6c0', fmt = v => v, onClick = null } = {}) {
    const max = Math.max(...rows.map(r => r.value), 1);
    return rows.map(r => `<${onClick ? 'button type="button" data-bar="' + esc(r.key) + '"' : 'div'} class="hbar" title="${esc(r.label)}: ${esc(fmt(r.value))}"><span class="hbar-label">${esc(r.label)}</span><span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(2, (r.value / max) * 100)}%;background:${r.color || color}"></span></span><strong>${esc(fmt(r.value))}</strong></${onClick ? 'button' : 'div'}>`).join('');
  }

  function renderStats() {
    const st = M.stats; if (!st) return;
    const sem = st.semana, totalSem = sem.reduce((a, x) => a + x.servicios, 0), factSem = sem.reduce((a, x) => a + Number(x.facturado), 0);
    const max = Math.max(...sem.map(x => x.servicios), 1);
    const r = st.rendimiento, cerrados = r.completados + r.cancelados;
    const colors = { SOLICITADO: '#f59e0b', ASIGNADO: '#3b82f6', EN_RECOJO: '#8b5cf6', EN_CURSO: '#0d9488', COMPLETADO: '#16a34a', CANCELADO: '#ef4444' };
    const byState = states.map(e => ({ key: e, label: LABEL[e], value: (st.estados.find(x => x.estado === e) || { cantidad: 0 }).cantidad, color: colors[e] }));
    const cats = st.categorias.map(c => ({ key: c.categoria, label: c.categoria.charAt(0).toUpperCase() + c.categoria.slice(1), value: c.cantidad }));
    $('statsGrid').innerHTML = `
      <article class="card stat-card"><div class="card-heading"><div><p class="eyebrow">ÚLTIMOS 7 DÍAS</p><h2 class="card-title">Servicios y facturación</h2></div><span class="tag">${totalSem} servicios · ${esc(money(factSem))}</span></div>
        <div class="week-chart">${sem.map((x, i) => `<div class="week-col${i === sem.length - 1 ? ' today' : ''}" title="${esc(shortDay(x.dia))}: ${x.servicios} servicios · ${esc(money(x.facturado))}"><b>${x.servicios}</b><span class="week-bar" style="height:${Math.max(3, x.servicios / max * 100)}px"></span><small>${esc(shortDay(x.dia))}</small></div>`).join('')}</div></article>
      <article class="card stat-card"><div class="card-heading"><div><p class="eyebrow">TODA LA BASE</p><h2 class="card-title">Servicios por estado</h2></div><span class="tag">Clic para filtrar</span></div><div class="hbars">${bars(byState, { onClick: true })}</div></article>
      <article class="card stat-card"><div class="card-heading"><div><p class="eyebrow">ÚLTIMOS 30 DÍAS</p><h2 class="card-title">Rendimiento</h2></div></div>
        <div class="mini-kpis"><div><strong>${cerrados ? pct(r.completados, cerrados) + '%' : '—'}</strong><span>Tasa de completados</span></div><div><strong>${r.minutos_promedio != null ? r.minutos_promedio + ' min' : '—'}</strong><span>Duración media</span></div><div><strong>${r.completados ? esc(money(r.tarifa_promedio)) : '—'}</strong><span>Tarifa media</span></div><div><strong>${r.cancelados}</strong><span>Cancelados</span></div></div>
        <p class="eyebrow" style="margin-top:18px">POR CATEGORÍA</p><div class="hbars">${cats.length ? bars(cats, { color: '#3b82f6' }) : '<p class="muted">Sin servicios en 30 días.</p>'}</div></article>
      <article class="card stat-card"><div class="card-heading"><div><p class="eyebrow">ÚLTIMOS 30 DÍAS</p><h2 class="card-title">Unidades destacadas</h2></div><button class="secondary" data-go="unidades" type="button">Ver todas</button></div>
        ${st.unidades.length ? `<ol class="rank-list">${st.unidades.map(u => `<li><span><strong>${esc(u.placa || u.codigo)}</strong><small>${esc(u.nombre)}</small></span><span class="rank-num">${u.servicios} serv.<small>${esc(money(u.facturado))}</small></span></li>`).join('')}</ol>` : '<div class="empty">Registra unidades para ver su rendimiento.</div>'}</article>`;
  }

  function enhanceKpis(data) {
    const targets = [['flujo-trabajo', null], ['unidades', null], ['despacho-flujo', 'COMPLETADO'], ['despacho-flujo', ''], ['consola-ia', null]];
    document.querySelectorAll('#metrics .kpi-card').forEach((card, i) => {
      if (!targets[i]) return;
      card.dataset.kgo = targets[i][0]; card.dataset.kfilter = targets[i][1] ?? ''; card.setAttribute('role', 'link'); card.tabIndex = 0; card.classList.add('kpi-link');
      card.title = 'Abrir detalle';
    });
    const extra = [`${data.servicios.pendientes} sin asignar`, `${data.unidades.total - data.unidades.disponibles} ocupadas`, `${data.servicios.completados_hoy} completados · ${data.servicios.cancelados_hoy} cancelados`, null, null];
    document.querySelectorAll('#metrics .kpi-card').forEach((card, i) => { if (extra[i]) card.insertAdjacentHTML('beforeend', `<div class="kpi-extra">${esc(extra[i])}</div>`); });
  }

  function hourChart(data) {
    const el = $('hourChart'), now = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    const hours = Array.from({ length: 24 }, (_, h) => data.horas.find(x => x.hora === h)?.cantidad || 0), max = Math.max(...hours, 1);
    if (!hours.some(Boolean)) return;
    el.innerHTML = hours.map((c, h) => `<div class="hour-column${h === now ? ' now' : ''}" title="${String(h).padStart(2, '0')}:00 · ${c} servicios"><b>${c || ''}</b><div class="hour-bar" style="height:${Math.max(2, c / max * 120)}px"></div><span>${String(h).padStart(2, '0')}</span></div>`).join('');
  }

  function onSync(summary) {
    M.summary = summary;
    attention(summary.servicios, summary.unidades);
    enhanceKpis(summary);
    hourChart(summary);
    api('/estadisticas').then(s => { M.stats = s; renderStats(); }).catch(() => { $('statsGrid').innerHTML = empty('No se pudieron cargar las estadísticas.'); });

  }

  /* =============== FLUJO DE TRABAJO =============== */
  function wfFilter() {
    const q = $('wfSearch').value.toLocaleLowerCase('es'), cat = $('wfCat').value;
    return state.services.filter(s => (!cat || s.categoria === cat) && (!q || [s.id, s.codigo, s.cliente, s.conductor, s.placa, s.origen, s.destino, s.telefono_cliente].some(v => String(v || '').toLocaleLowerCase('es').includes(q))));
  }
  function availableFor(s) { return state.drivers.filter(d => d.estado === 'DISPONIBLE' && d.categoria === s.categoria); }

  function ticket(s) {
    const idx = STEPS.indexOf(s.estado), cancelled = s.estado === 'CANCELADO', active = !['COMPLETADO', 'CANCELADO'].includes(s.estado);
    const wait = s.estado === 'SOLICITADO' && ageMin(s.creado_en) >= 5;
    const dots = cancelled ? '' : `<div class="steps" aria-hidden="true">${STEPS.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`;
    let actions = '';
    if (s.estado === 'SOLICITADO') {
      const free = availableFor(s);
      actions = free.length
        ? `<div class="tk-assign"><select aria-label="Unidad para el servicio ${s.id}" data-assign-select="${s.id}">${options(free, 'Elegir unidad…')}</select><button data-act="assign" data-id="${s.id}" type="button">Asignar</button></div>`
        : `<p class="tk-warn">Sin unidades ${esc(s.categoria)} disponibles</p>`;
    } else if (NEXT[s.estado]) {
      actions = `<button data-act="next" data-id="${s.id}" type="button">${NEXT_TEXT[NEXT[s.estado]]} →</button>`;
    }
    const secondary = active ? `<div class="tk-row"><button class="secondary" data-edit="${s.id}" type="button">Detalles</button>${s.telefono_cliente ? `<a class="tk-call" href="tel:${esc(s.telefono_cliente)}" title="Llamar al cliente">📞</a>` : ''}<button class="secondary danger" data-act="cancel" data-id="${s.id}" type="button">Cancelar</button></div>` : `<div class="tk-row"><button class="secondary" data-edit="${s.id}" type="button">Detalles</button></div>`;
    return `<article class="service-ticket tk ${wait ? 'tk-late' : ''}" ${active ? 'draggable="true"' : ''} data-id="${s.id}">
      <div class="tk-top"><span class="ticket-code">#${s.id} · ${esc(s.categoria)}</span><span class="tk-age${wait ? ' late' : ''}" title="Tiempo desde la solicitud">${active ? '⏱ ' + age(s.creado_en) : dateTime(s.finalizado_en || s.actualizado_en)}</span></div>
      <strong>${esc(s.cliente || 'Cliente')}</strong>
      <div class="tk-route"><span>${esc(s.origen)}</span><span class="tk-arrow">↓</span><span>${esc(s.destino)}</span></div>
      <div class="tk-meta"><span>${s.placa ? '🚖 ' + esc(s.placa) + ' · ' + esc(s.conductor || '') : 'Sin unidad'}</span><span>${esc(money(s.tarifa))}</span></div>
      ${dots}${actions}${secondary}</article>`;
  }

  function renderWorkflow() {
    if (!$('workflow') || M.busy || M.dragId) return;
    if ($('workflow').contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return; // no interrumpir una selección
    const list = wfFilter(), hide = $('wfHideDone').checked;
    const active = state.services.filter(s => !['COMPLETADO', 'CANCELADO'].includes(s.estado)).length;
    const free = state.drivers.filter(d => d.estado === 'DISPONIBLE').length;
    const late = state.services.filter(s => s.estado === 'SOLICITADO' && ageMin(s.creado_en) >= 5).length;
    $('wfStats').innerHTML = `<span><b>${active}</b> activos</span><span class="${late ? 'late' : ''}"><b>${late}</b> esperando +5 min</span><span><b>${free}</b> unidades libres</span><span><b>${state.services.filter(s => s.estado === 'COMPLETADO').length}</b> completados</span>`;
    const scroll = $('workflow').scrollLeft;
    $('workflow').innerHTML = states.map(st => {
      const items = list.filter(s => s.estado === st), terminal = ['COMPLETADO', 'CANCELADO'].includes(st);
      if (terminal && hide) return '';
      const shown = terminal ? items.slice(0, TERMINAL_LIMIT) : items;
      return `<section class="workflow-lane lane-${st.toLowerCase()}" data-state="${st}" aria-label="${LABEL[st]}"><div class="lane-heading">${badge(st)}<span class="lane-count">${items.length}</span></div><div class="lane-body">${shown.map(ticket).join('') || `<p class="lane-empty">${EMPTY_HINT[st]}</p>`}${items.length > shown.length ? `<button class="secondary lane-more" data-go="despacho-flujo" data-filter="${st}" type="button">+${items.length - shown.length} más en despacho</button>` : ''}</div></section>`;
    }).join('');
    $('workflow').scrollLeft = scroll;
  }

  async function move(id, to, driverId) {
    const s = state.services.find(x => x.id === Number(id)); if (!s) return;
    if (!(transitions[s.estado] || []).includes(to)) { toast(`No se puede pasar de “${LABEL[s.estado]}” a “${LABEL[to]}”. Sigue el orden del flujo.`); return; }
    const driver = driverId ? Number(driverId) : s.conductor_id;
    if (to === 'ASIGNADO' && !driver) { toast('Elige una unidad disponible para asignar el servicio.'); document.querySelector(`[data-assign-select="${s.id}"]`)?.focus(); return; }
    if (to === 'COMPLETADO' && s.tarifa == null) { editService(s.id); $('editStatus').value = 'COMPLETADO'; $('editFare').focus(); toast('Registra la tarifa acordada para completar el servicio.'); return; }
    if (to === 'CANCELADO' && !confirm(`¿Cancelar el servicio #${s.id} de ${s.cliente || 'cliente'}?`)) return;
    M.busy = true;
    try {
      await api(`/servicios/${s.id}`, { method: 'PATCH', body: JSON.stringify({ estado: to, conductor_id: driver || null }) });
      toast(`Servicio #${s.id}: ${LABEL[to]}.`);
    } catch (e) { toast(e.message); }
    finally { M.busy = false; await sync(); }
  }

  function bindWorkflow() {
    ['wfSearch', 'wfCat', 'wfHideDone'].forEach(id => $(id).addEventListener('input', renderWorkflow));
    $('wfNew').onclick = () => $('serviceDialog').showModal();
    const board = $('workflow');
    board.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'assign') move(id, 'ASIGNADO', document.querySelector(`[data-assign-select="${id}"]`)?.value);
      if (b.dataset.act === 'next') { const s = state.services.find(x => x.id === Number(id)); move(id, NEXT[s.estado]); }
      if (b.dataset.act === 'cancel') move(id, 'CANCELADO');
    });
    board.addEventListener('dragstart', e => {
      const t = e.target.closest('.service-ticket'); if (!t) return;
      M.dragId = Number(t.dataset.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.dataset.id);
      requestAnimationFrame(() => t.classList.add('dragging'));
      const s = state.services.find(x => x.id === M.dragId);
      board.querySelectorAll('.workflow-lane').forEach(l => l.classList.toggle('drop-ok', (transitions[s.estado] || []).includes(l.dataset.state)));
    });
    board.addEventListener('dragend', () => { M.dragId = null; board.querySelectorAll('.dragging,.drop-ok,.drop-over').forEach(x => x.classList.remove('dragging', 'drop-ok', 'drop-over')); renderWorkflow(); });
    board.addEventListener('dragover', e => { const l = e.target.closest('.workflow-lane'); if (l && l.classList.contains('drop-ok')) { e.preventDefault(); l.classList.add('drop-over'); } });
    board.addEventListener('dragleave', e => { const l = e.target.closest('.workflow-lane'); if (l && !l.contains(e.relatedTarget)) l.classList.remove('drop-over'); });
    board.addEventListener('drop', e => {
      const l = e.target.closest('.workflow-lane'); if (!l || M.dragId == null) return; e.preventDefault();
      const id = M.dragId, to = l.dataset.state; M.dragId = null;
      board.querySelectorAll('.drop-ok,.drop-over').forEach(x => x.classList.remove('drop-ok', 'drop-over'));
      move(id, to, document.querySelector(`[data-assign-select="${id}"]`)?.value);
    });
  }

  /* ---- llamadas ---- */
  const parseTranscript = t => String(t || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const m = l.match(/^(CLIENTE|IA|AZURE):\s*(.*)$/i); return m ? { rol: m[1].toUpperCase().startsWith('CLI') ? 'usuario' : 'asistente', contenido: m[2] } : { rol: 'asistente', contenido: l }; });
  function renderCalls() {
    const q = $('callSearch').value.toLocaleLowerCase('es'), st = $('callStatus').value;
    const list = M.calls.filter(c => (!st || c.estado === st) && [c.cliente, c.telefono_origen].some(v => String(v || '').toLocaleLowerCase('es').includes(q)));
    $('calls').innerHTML = list.map(c => `<button class="call-row${M.selectedCall === c.id ? ' sel' : ''}" data-call="${c.id}" type="button"><span><strong>${esc(c.cliente || c.telefono_origen || 'Desconocido')}</strong><small>${esc(c.telefono_origen || '')}</small></span><span class="call-meta">${badge(c.estado)}<small>${dateTime(c.inicio)}</small></span></button>`).join('') || empty(M.calls.length ? 'Ninguna llamada coincide con la búsqueda.' : 'Aún no hay llamadas registradas. Aparecerán aquí cuando el agente Azure envíe sus registros.');
  }
  async function showCall(id) {
    M.selectedCall = Number(id); renderCalls();
    const c = M.calls.find(x => x.id === M.selectedCall); if (!c) return;
    let msgs = [];
    try { msgs = await api(`/llamadas/${c.id}/conversacion`); } catch (_) {}
    if (!msgs.length) msgs = parseTranscript(c.transcripcion);
    $('callDetail').innerHTML = `<div class="call-head"><div><h3>${esc(c.cliente || c.telefono_origen)}</h3><p class="muted">${esc(c.telefono_origen || '')} · ${dateTime(c.inicio)}${c.fin ? ' → ' + dateTime(c.fin) : ''}</p></div>${badge(c.estado)}</div>
      <div class="chat call-chat">${msgs.length ? msgs.map(m => `<div class="bubble ${m.rol === 'usuario' ? 'user' : 'assistant'}">${esc(m.contenido)}</div>`).join('') : '<div class="empty">Sin transcripción registrada.</div>'}</div>
      <div class="call-actions"><button data-call-service="${c.id}" type="button">Crear servicio con estos datos</button>${c.telefono_origen ? `<a class="btn-link" href="tel:${esc(c.telefono_origen)}">📞 Devolver llamada</a>` : ''}</div>`;
  }
  async function loadAutomation() {
    try {
      const [connections,jobs]=await Promise.all([api('/conexiones'),api('/automatizaciones')]);
      $('aiConnections').innerHTML=connections.map(c=>`<p><strong>${esc(c.nombre)}</strong> ${badge(c.estado)}<small>${esc(c.detalle)}</small></p>`).join('');
      $('automationList').innerHTML=jobs.map(j=>`<p>Servicio #${j.servicio_id} · ${esc(j.tipo)} ${badge(j.estado)}</p>`).join('') || empty('Sin automatizaciones registradas.');
      const active=M.calls.find(c=>!c.fin);
      $('activeCall').innerHTML=active?`<h3>Llamada en curso</h3><p>${esc(active.cliente || active.telefono_origen)} · ${dateTime(active.inicio)} ${badge(active.estado)}</p><button data-call="${active.id}" type="button">Ver conversación</button>`:empty('Sin llamadas en curso.');
      $('activeCall').onclick=e=>{const b=e.target.closest('[data-call]');if(b)showCall(b.dataset.call);};
      if(M.selectedCall)await showCall(M.selectedCall);
    } catch(e){$('automationList').innerHTML=empty(e.message);}
  }
  async function loadCalls() {
    try {
      M.calls = await api('/llamadas');
      const estados = [...new Set(M.calls.map(c => c.estado))], cur = $('callStatus').value;
      $('callStatus').innerHTML = '<option value="">Todos los estados</option>' + estados.map(e => `<option>${esc(e)}</option>`).join(''); $('callStatus').value = cur;
      renderCalls();
    } catch (e) { $('calls').innerHTML = empty(e.message); }
    await loadAutomation();

  }

  function bindConsole() {
    $('retryAutomation').onclick=async()=>{try{await api('/automatizaciones/procesar',{method:'POST',body:'{}'});await loadAutomation();}catch(e){toast(e.message);}};
    $('callSearch').oninput = renderCalls; $('callStatus').onchange = renderCalls;
    $('calls').addEventListener('click', e => { const b = e.target.closest('[data-call]'); if (b) showCall(b.dataset.call); });
    $('callDetail').addEventListener('click', e => {
      const b = e.target.closest('[data-call-service]'); if (!b) return;
      const c = M.calls.find(x => x.id === Number(b.dataset.callService)), f = $('serviceForm');
      if (f && c) { if (f.elements.nombre) f.elements.nombre.value = c.cliente && c.cliente !== 'Cliente telefónico' ? c.cliente : ''; if (f.elements.telefono) f.elements.telefono.value = c.telefono_origen || ''; }
      $('serviceDialog').showModal();
    });
  }

  /* =============== ARRANQUE =============== */
  function init() {
    bindWorkflow(); bindConsole();
    document.addEventListener('click', e => {
      const a = e.target.closest('[data-attn]'); if (a) M.attentionActions[Number(a.dataset.attn)]?.();
      const bar = e.target.closest('[data-bar]'); if (bar) goto('despacho-flujo', bar.dataset.bar);
      const k = e.target.closest('.kpi-link'); if (k) goto(k.dataset.kgo, k.dataset.kfilter);
      const lm = e.target.closest('.lane-more'); if (lm) goto('despacho-flujo', lm.dataset.filter);
    });
    document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('kpi-link')) { e.preventDefault(); goto(e.target.dataset.kgo, e.target.dataset.kfilter); } });
  }
  window.renderWorkflow = renderWorkflow; window.loadCalls = loadCalls;
  return { init, onSync };
})();
