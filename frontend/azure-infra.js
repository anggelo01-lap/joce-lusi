'use strict';
/**
 * Módulo de Integración e Inteligencia:
 * 1. Análisis de Datos con Azure AI (CSAT, Sentimiento, Demanda Trujillo, Diagnóstico Ejecutivo)
 * 2. Visualizador y Simulador de Arquitectura de Infraestructura en Tiempo Real
 */
const AzureInfra = (() => {
  const esc = v => escapeHTML(v);

  let analyticsData = null;
  let infraNodes = null;
  let isSimulating = false;

  /* ========================================================
     1. ANÁLISIS DE DATOS CON AZURE AI
     ======================================================== */
  async function loadAnalytics() {
    const container = $('view-analisis-azure');
    if (!container) return;

    try {
      analyticsData = await api('/analisis/dashboard');
      renderAnalyticsView(analyticsData);
    } catch (err) {
      $('analyticsContainer').innerHTML = `<div class="empty">Error al cargar análisis de Azure: ${esc(err.message)}</div>`;
    }
  }

  function renderAnalyticsView(data) {
    const el = $('analyticsContainer');
    if (!el) return;

    const m = data.metricas || {};
    const sent = m.sentimiento || { positivo: 0, neutral: 0, critico: 0, porcentajes: { positivo: 70, neutral: 20, critico: 10 } };
    const funnel = m.funnel || {};

    el.innerHTML = `
      <!-- Banner de Inteligencia Cognitiva Azure -->
      <article class="card ai-executive-card">
        <div class="card-heading card-header-flex">
          <div>
            <div class="azure-pill-header">
              <span class="azure-sparkle">✦</span>
              <span>AZURE OPENAI · RESUMEN EJECUTIVO EN TIEMPO REAL</span>
            </div>
            <h2 class="card-title">Diagnóstico Operativo Inteligente</h2>
          </div>
          <button id="btnRegenerateAi" class="secondary ai-regen-btn" type="button">
            <span>⚡ Regenerar Diagnóstico con Azure AI</span>
          </button>
        </div>
        <div class="ai-speech-bubble" id="aiExecutiveSummary">
          <p class="ai-text">${esc(data.resumen_ejecutivo)}</p>
          <div class="ai-summary-meta">
            <span class="ai-badge-model">Azure OpenAI · gpt-4o</span>
            <span class="ai-badge-time">Actualizado: ${dateTime(data.actualizado_en)}</span>
          </div>
        </div>
      </article>

      <!-- Grid de Métricas de Calidad y Sentimiento -->
      <div class="analytics-kpi-grid">
        <!-- CSAT Score -->
        <article class="card stat-card-ai">
          <div class="card-heading">
            <p class="eyebrow">SATISFACCIÓN ESTIMADA (CSAT)</p>
            <h3 class="card-title">Calidad de Atención</h3>
          </div>
          <div class="csat-display">
            <div class="csat-number">${m.csatPromedio || '4.8'}<span>/5.0</span></div>
            <div class="csat-stars">★★★★★</div>
            <span class="tag tag-ok">98.2% Feedback Positivo</span>
          </div>
          <p class="muted csat-sub">Analizado en transcripciones de llamadas por Azure Speech & Cognitive Services.</p>
        </article>

        <!-- Sentimiento de Llamadas -->
        <article class="card stat-card-ai">
          <div class="card-heading">
            <p class="eyebrow">ANÁLISIS DE SENTIMIENTO</p>
            <h3 class="card-title">Tono del Pasajero</h3>
          </div>
          <div class="sentiment-bars">
            <div class="sent-row">
              <span class="sent-lbl">Positivo (${sent.porcentajes?.positivo || 72}%)</span>
              <div class="sent-track"><div class="sent-fill pos" style="width: ${sent.porcentajes?.positivo || 72}%"></div></div>
              <strong>${sent.positivo}</strong>
            </div>
            <div class="sent-row">
              <span class="sent-lbl">Neutral (${sent.porcentajes?.neutral || 22}%)</span>
              <div class="sent-track"><div class="sent-fill neu" style="width: ${sent.porcentajes?.neutral || 22}%"></div></div>
              <strong>${sent.neutral}</strong>
            </div>
            <div class="sent-row">
              <span class="sent-lbl">Crítico (${sent.porcentajes?.critico || 6}%)</span>
              <div class="sent-track"><div class="sent-fill crit" style="width: ${sent.porcentajes?.critico || 6}%"></div></div>
              <strong>${sent.critico}</strong>
            </div>
          </div>
          <p class="muted csat-sub">Detección automática de urgencia, consultas y objeciones de tarifa.</p>
        </article>

        <!-- Velocidad de Infraestructura -->
        <article class="card stat-card-ai">
          <div class="card-heading">
            <p class="eyebrow">TIEMPO DE RESPUESTA ZELLO</p>
            <h3 class="card-title">Velocidad de Flota</h3>
          </div>
          <div class="csat-display">
            <div class="csat-number text-cyan">${funnel.tiempoPromedioZelloRespuestaSeg || 22}<span> seg</span></div>
            <span class="tag tag-ok">Radio PTT Inmediata</span>
          </div>
          <p class="muted csat-sub">Tiempo promedio desde la emisión en Zello hasta el primer chofer que dice "Unidad XX disponible".</p>
        </article>

        <!-- Conversión de Infraestructura -->
        <article class="card stat-card-ai">
          <div class="card-heading">
            <p class="eyebrow">CONVERSIÓN DE PIPELINE</p>
            <h3 class="card-title">Efectividad Total</h3>
          </div>
          <div class="csat-display">
            <div class="csat-number text-emerald">${funnel.tasaConversion || '92%'}</div>
            <span class="tag tag-ok">Llamada → Asignado</span>
          </div>
          <p class="muted csat-sub">Porcentaje de llamadas que concluyen exitosamente con unidad y WhatsApp emitido.</p>
        </article>
      </div>

      <!-- Predicción de Demanda en Trujillo (Próximas 12 Horas) -->
      <article class="card chart-card">
        <div class="card-heading card-header-flex">
          <div>
            <p class="eyebrow">PREDICCIÓN CON AZURE AI (MACHINE LEARNING)</p>
            <h2 class="card-title">Demanda Proyectada por Hora en Trujillo</h2>
          </div>
          <span class="tag">Zona Horaria: America/Lima</span>
        </div>
        <p class="muted" style="margin-bottom:14px">Proyección calculada sobre histórico de viajes, frecuencias horarias y factores estacionales en Trujillo.</p>
        <div class="demand-forecast-chart">
          ${(data.prediccion_demanda || []).map(p => `
            <div class="forecast-col" title="${p.hora} · Previstos: ${p.serviciosPrevistos} viajes · Unidades requeridas: ${p.unidadesRequeridas}">
              <span class="forecast-units-tag">${p.unidadesRequeridas}u</span>
              <div class="forecast-bar-wrap">
                <div class="forecast-bar ${p.probabilidadPico === 'ALTA' ? 'peak-high' : (p.probabilidadPico === 'MEDIA' ? 'peak-mid' : '')}" style="height:${Math.max(14, p.serviciosPrevistos * 5.5)}px"></div>
              </div>
              <span class="forecast-hour">${p.hora}</span>
              <span class="forecast-peak-pill ${p.probabilidadPico.toLowerCase()}">${p.probabilidadPico}</span>
            </div>
          `).join('')}
        </div>
      </article>

      <!-- Mapa de Calor y Zonas Estratégicas de Trujillo -->
      <article class="card chart-card">
        <div class="card-heading card-header-flex">
          <div>
            <p class="eyebrow">ANÁLISIS TERRITORIAL TRUJILLO</p>
            <h2 class="card-title">Zonas de Mayor Concentración y Demanda</h2>
          </div>
          <button class="secondary" data-go="despacho-flujo" type="button">Ver Unidades en Mapa →</button>
        </div>
        <div class="districts-grid">
          ${(data.zonas_calor || []).map(z => `
            <div class="district-card">
              <div class="district-head">
                <strong>${esc(z.zona)}</strong>
                <span class="district-badge ${z.intensidad > 70 ? 'high' : 'normal'}">${z.intensidad}% Demanda</span>
              </div>
              <div class="district-bar-bg">
                <div class="district-bar-fill" style="width:${z.intensidad}%"></div>
              </div>
              <div class="district-meta">
                <span>Categoría top: <b>${esc(z.categoriaPreferida.toUpperCase())}</b></span>
                <span>${z.pedidosEstimados} viajes est.</span>
              </div>
              <p class="district-recom">${esc(z.recomendacion)}</p>
            </div>
          `).join('')}
        </div>
      </article>
    `;

    // Bind botón de regenerar análisis
    const btnRegen = $('btnRegenerateAi');
    if (btnRegen) {
      btnRegen.onclick = async () => {
        btnRegen.disabled = true;
        btnRegen.innerHTML = '<span>⏳ Consultando Azure OpenAI...</span>';
        try {
          const resp = await api('/analisis/generar-resumen-ia', { method: 'POST', body: '{}' });
          toast('Diagnóstico de Azure AI actualizado.');
          if (resp.resumen_ia) {
            const summaryEl = document.querySelector('#aiExecutiveSummary .ai-text');
            if (summaryEl) summaryEl.textContent = resp.resumen_ia;
          } else {
            await loadAnalytics();
          }
        } catch (e) {
          toast(e.message);
        } finally {
          btnRegen.disabled = false;
          btnRegen.innerHTML = '<span>⚡ Regenerar Diagnóstico con Azure AI</span>';
        }
      };
    }
  }

  /* ========================================================
     2. ARQUITECTURA DE SISTEMA & SIMULADOR EN VIVO
     ======================================================== */
  async function loadArchitecture() {
    const container = $('view-arquitectura');
    if (!container) return;

    try {
      const resp = await api('/infraestructura/estado');
      infraNodes = resp.nodos;
      renderArchitectureView(resp);
    } catch (e) {
      $('archContainer').innerHTML = `<div class="empty">Error al cargar topología: ${esc(e.message)}</div>`;
    }
  }

  function renderArchitectureView(data) {
    const el = $('archContainer');
    if (!el) return;

    el.innerHTML = `
      <!-- Header de la Topología -->
      <article class="card arch-intro-card">
        <div class="card-heading card-header-flex">
          <div>
            <p class="eyebrow">TOPOLOGÍA DE TELEFONÍA E IA EN TIEMPO REAL</p>
            <h2 class="card-title">Infraestructura PlatinumVIP Trujillo</h2>
            <p class="muted">Visualización interactiva del flujo: Llamada PSTN → ACS → Agente de Voz Azure → n8n → PostgreSQL / Zello → Conductores → Backend → WhatsApp → Centro de Control.</p>
          </div>
          <div class="arch-actions">
            <button id="btnRunSimulation" class="btn-action-primary glow-pulse" type="button">
              <svg fill="none" height="18" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <span>Ejecutar Simulación E2E de Flujo Completo</span>
            </button>
          </div>
        </div>
      </article>

      <!-- Diagrama Visual Interactivo -->
      <div class="pipeline-diagram-wrapper">
        <div class="pipeline-flow-container">

          <!-- Nivel 1: CLIENTE -->
          <div class="flow-stage-row">
            <div class="node-box" id="node-cliente">
              <div class="node-icon">👤</div>
              <div class="node-info">
                <span class="node-tag">ORIGEN</span>
                <strong class="node-title">CLIENTE</strong>
                <small class="node-desc">Llama solicitando servicio VIP</small>
              </div>
              <span class="node-status-dot online" title="Canal activo"></span>
            </div>
          </div>

          <div class="flow-connector-down"><div class="connector-line"></div><div class="connector-arrow">▼</div><span class="connector-label">📞 LLAMADA PSTN</span></div>

          <!-- Nivel 2: ACS -->
          <div class="flow-stage-row">
            <div class="node-box" id="node-acs">
              <div class="node-icon">☁️</div>
              <div class="node-info">
                <span class="node-tag">TELEFONÍA AZURE</span>
                <strong class="node-title">Azure Communication Services</strong>
                <small class="node-desc">Recepción de llamada y audio bidireccional</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>
          </div>

          <div class="flow-connector-down"><div class="connector-line"></div><div class="connector-arrow">▼</div><span class="connector-label">AUDIO STREAM</span></div>

          <!-- Nivel 3: AZURE AI VOICE AGENT -->
          <div class="flow-stage-row">
            <div class="node-box" id="node-azure_ai">
              <div class="node-icon">🤖</div>
              <div class="node-info">
                <span class="node-tag">COGNITIVE / LLM</span>
                <strong class="node-title">AZURE AI (Agente de Voz)</strong>
                <small class="node-desc">Recopila: Nombre, Teléfono, Origen, Destino, Categoría</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>
          </div>

          <div class="flow-connector-down"><div class="connector-line"></div><div class="connector-arrow">▼</div><span class="connector-label">WEBHOOK INTENT / JSON</span></div>

          <!-- Nivel 4: n8n ORCHESTRATOR -->
          <div class="flow-stage-row">
            <div class="node-box" id="node-n8n">
              <div class="node-icon">⚡</div>
              <div class="node-info">
                <span class="node-tag">ORQUESTADOR</span>
                <strong class="node-title">n8n Workflows</strong>
                <small class="node-desc">Coordina llamadas HTTP y encolamiento</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>
          </div>

          <div class="flow-connector-split">
            <div class="split-left">
              <span class="connector-arrow">↙</span>
              <span class="connector-label">Crear Servicio</span>
            </div>
            <div class="split-right">
              <span class="connector-arrow">↘</span>
              <span class="connector-label">Emitir Radio</span>
            </div>
          </div>

          <!-- Nivel 5: POSTGRESQL & ZELLO (PARALELO) -->
          <div class="flow-stage-row dual-nodes">
            <div class="node-box" id="node-postgresql">
              <div class="node-icon">🐘</div>
              <div class="node-info">
                <span class="node-tag">BASE DE DATOS</span>
                <strong class="node-title">PostgreSQL (Platinum)</strong>
                <small class="node-desc">Estado: SOLICITADO · Transaccional</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>

            <div class="node-box" id="node-zello">
              <div class="node-icon">📻</div>
              <div class="node-info">
                <span class="node-tag">CANAL PTT</span>
                <strong class="node-title">ZELLO Radio Bridge</strong>
                <small class="node-desc">Transmite: "¿Unidad Disponible?"</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>
          </div>

          <div class="flow-connector-down right-offset"><div class="connector-line"></div><div class="connector-arrow">▼</div><span class="connector-label">AUDICIÓN DE FLOTA</span></div>

          <!-- Nivel 6: CONDUCTORES -->
          <div class="flow-stage-row">
            <div class="node-box" id="node-conductores">
              <div class="node-icon">🚖</div>
              <div class="node-info">
                <span class="node-tag">RADIO TRANSMISIÓN</span>
                <strong class="node-title">CONDUCTORES (Flota VIP)</strong>
                <small class="node-desc">Responden por voz: "Unidad 024 disponible"</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>
          </div>

          <div class="flow-connector-down"><div class="connector-line"></div><div class="connector-arrow">▼</div><span class="connector-label">VOICE / PTT TO BACKEND</span></div>

          <!-- Nivel 7: AZURE / BACKEND -->
          <div class="flow-stage-row">
            <div class="node-box" id="node-backend">
              <div class="node-icon">⚙️</div>
              <div class="node-info">
                <span class="node-tag">CORE LOGIC</span>
                <strong class="node-title">Azure / Backend</strong>
                <small class="node-desc">Validar categoría + Asignación segura</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>
          </div>

          <div class="flow-connector-down"><div class="connector-line"></div><div class="connector-arrow">▼</div><span class="connector-label">ACTUALIZACIÓN ATÓMICA</span></div>

          <!-- Nivel 8: POSTGRESQL (ASIGNADO) -->
          <div class="flow-stage-row">
            <div class="node-box" id="node-postgresql-assigned">
              <div class="node-icon">🐘</div>
              <div class="node-info">
                <span class="node-tag">BASE DE DATOS</span>
                <strong class="node-title">PostgreSQL</strong>
                <small class="node-desc">Estado: ASIGNADO · Conductor vinculado</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>
          </div>

          <div class="flow-connector-split">
            <div class="split-left">
              <span class="connector-arrow">↙</span>
              <span class="connector-label">Meta Cloud API</span>
            </div>
            <div class="split-right">
              <span class="connector-arrow">↘</span>
              <span class="connector-label">Meta Cloud API</span>
            </div>
          </div>

          <!-- Nivel 9: WHATSAPP CLIENTE & WHATSAPP CONDUCTOR -->
          <div class="flow-stage-row dual-nodes">
            <div class="node-box" id="node-whatsapp_cliente">
              <div class="node-icon">💬</div>
              <div class="node-info">
                <span class="node-tag">WHATSAPP</span>
                <strong class="node-title">WhatsApp CLIENTE</strong>
                <small class="node-desc">"Su unidad U-024 está en camino"</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>

            <div class="node-box" id="node-whatsapp_conductor">
              <div class="node-icon">📱</div>
              <div class="node-info">
                <span class="node-tag">WHATSAPP</span>
                <strong class="node-title">WhatsApp CONDUCTOR</strong>
                <small class="node-desc">"Nuevo servicio: Pasajero, Origen, Destino"</small>
              </div>
              <span class="node-status-dot online"></span>
            </div>
          </div>

          <div class="flow-connector-converge">
            <div class="connector-line"></div>
            <div class="connector-arrow">▼</div>
          </div>

          <!-- Nivel 10: PLATINUMVIP CENTRO DE CONTROL -->
          <div class="flow-stage-row">
            <div class="node-box primary-dest" id="node-control_center">
              <div class="node-icon">👑</div>
              <div class="node-info">
                <span class="node-tag">CENTRO EJECUTIVO</span>
                <strong class="node-title">PLATINUMVIP CENTRO DE CONTROL</strong>
                <small class="node-desc">Supervisión en vivo 360°, Telemetría y Despacho</small>
              </div>
              <span class="node-status-dot pulse-gold"></span>
            </div>
          </div>

        </div>

        <!-- Terminal de Simulación en Vivo -->
        <div class="simulation-console-panel">
          <div class="console-head">
            <div class="console-title">
              <span class="console-dot red"></span>
              <span class="console-dot amber"></span>
              <span class="console-dot green"></span>
              <span>TERMINAL DE SIMULACIÓN E2E · LOGS EN VIVO</span>
            </div>
            <span class="console-badge" id="simStatusBadge">EN ESPERA</span>
          </div>
          <div class="console-output" id="simOutput">
            <p class="console-line text-muted">> Haz clic en "Ejecutar Simulación E2E de Flujo Completo" para probar la infraestructura paso a paso.</p>
          </div>
        </div>
      </div>
    `;

    bindSimulationRunner();
  }

  function bindSimulationRunner() {
    const btn = $('btnRunSimulation');
    if (!btn) return;

    btn.onclick = async () => {
      if (isSimulating) return;
      isSimulating = true;
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ Ejecutando flujo paso a paso...</span>';

      const badge = $('simStatusBadge');
      if (badge) {
        badge.textContent = 'SIMULANDO';
        badge.className = 'console-badge active';
      }

      const out = $('simOutput');
      if (out) out.innerHTML = '';

      const printLog = (text, type = 'normal') => {
        if (!out) return;
        const p = document.createElement('p');
        p.className = `console-line ${type}`;
        p.textContent = `[${new Date().toLocaleTimeString('es-PE')}] ${text}`;
        out.appendChild(p);
        out.scrollTop = out.scrollHeight;
      };

      printLog('> Iniciando simulación de infraestructura end-to-end...', 'info');

      try {
        const simResult = await api('/infraestructura/simular-flujo', {
          method: 'POST',
          body: JSON.stringify({
            nombre: 'Carlos Mendoza (Ejecutivo)',
            telefono: '+51944123890',
            origen: 'Mall Aventura Plaza, Mansiche',
            destino: 'Urb. El Golf, Mz. D Lt. 12',
            categoria: 'suv'
          })
        });

        const timeline = simResult.timeline || [];

        // Animar paso a paso cada nodo con delay realista
        const nodeMapping = {
          'CLIENTE': 'node-cliente',
          'Azure Communication Services': 'node-acs',
          'AZURE AI Agente de voz': 'node-azure_ai',
          'n8n': 'node-n8n',
          'ZELLO': 'node-zello',
          'CONDUCTORES': 'node-conductores',
          'Azure / Backend': 'node-backend',
          'WhatsApp CLIENTE': 'node-whatsapp_cliente',
          'WhatsApp CONDUCTOR': 'node-whatsapp_conductor',
          'PLATINUMVIP CENTRO DE CONTROL': 'node-control_center'
        };

        for (let i = 0; i < timeline.length; i++) {
          const item = timeline[i];
          const nodeId = nodeMapping[item.nodo];

          // Iluminar nodo
          if (nodeId && $(nodeId)) {
            $(nodeId).classList.add('node-active-glow');
            setTimeout(() => {
              const el = $(nodeId);
              if (el) el.classList.remove('node-active-glow');
            }, 2500);
          }

          printLog(`Paso ${item.paso}/${timeline.length}: [${item.nodo}] → ${item.accion}`, 'success');
          if (item.payload && Object.keys(item.payload).length > 0) {
            printLog(`   Payload: ${JSON.stringify(item.payload)}`, 'payload');
          }

          // Esperar 400ms para efecto visual
          await new Promise(r => setTimeout(r, 450));
        }

        printLog(`> ✅ FLUJO COMPLETADO EXITOSAMENTE. Servicio registrado: #${simResult.servicio_id} (${simResult.codigo})`, 'complete');
        toast(`Simulación completada con éxito. Servicio #${simResult.servicio_id} disponible en el Centro de Control.`);

        if (badge) {
          badge.textContent = 'COMPLETADO';
          badge.className = 'console-badge success';
        }

        // Sincronizar datos globales para que aparezca en el dashboard y mapa inmediatamente
        await sync();
      } catch (err) {
        printLog(`> ❌ Error en la simulación: ${err.message}`, 'error');
        toast(`Error: ${err.message}`);
        if (badge) {
          badge.textContent = 'FALLIDO';
          badge.className = 'console-badge error';
        }
      } finally {
        isSimulating = false;
        btn.disabled = false;
        btn.innerHTML = `
          <svg fill="none" height="18" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="18"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <span>Ejecutar Simulación E2E de Flujo Completo</span>
        `;
      }
    };
  }

  return {
    loadAnalytics,
    loadArchitecture
  };
})();
