/* Charts use the same loaded records as the operational tables. */
let operationalPeriod = 7;
function renderOperationalCharts(days = operationalPeriod) {
  operationalPeriod = days;
  const result = PlatinumAnalitica.analyze(appState.servicios, [], {days});
  const containers = document.querySelectorAll('#view-panel-principal .chart-svg-container');
  const svg = (body, label) => `<svg viewBox="0 0 600 200" role="img" aria-label="${label}" style="width:100%;height:220px">${body}</svg>`;
  const max = Math.max(1, ...result.daily.map(d => d.count));
  const x = i => 35 + i * 530 / Math.max(1, days - 1);
  const y = n => 160 - n / max * 130;
  if (containers[0]) containers[0].innerHTML = svg(
    `<text x="10" y="20" fill="#64748b">Servicios registrados · últimos ${days} días</text><path d="${result.daily.map((d,i) => `${i ? 'L' : 'M'}${x(i)} ${y(d.count)}`).join(' ')}" fill="none" stroke="#2563eb" stroke-width="3"/>` +
    result.daily.filter((d,i) => i % Math.ceil(days/7) === 0 || i === days-1).map(d => {
      const i = result.daily.indexOf(d);
      return `<text x="${x(i)}" y="185" text-anchor="middle" font-size="10" fill="#64748b">${d.date.slice(5)}</text><text x="${x(i)}" y="${y(d.count)-8}" text-anchor="middle" font-size="11">${d.count}</text>`;
    }).join(''), 'Demanda según registros cargados');
  if (containers[1]) containers[1].innerHTML = svg(result.hours.map((h,i) => {
    const height = h.count / Math.max(1,...result.hours.map(v=>v.count)) * 130;
    return `<rect x="${25+i*23}" y="${160-height}" width="15" height="${height}" rx="3" fill="#2563eb"/><text x="${32+i*23}" y="${150-height}" text-anchor="middle" font-size="9">${h.count || ''}</text>${i%3===0?`<text x="${32+i*23}" y="185" text-anchor="middle" font-size="10">${i}h</text>`:''}`;
  }).join(''), 'Servicios por hora en el período seleccionado');
  const legend = document.querySelector('.donut-legend-list');
  const colors = ['#22c55e','#f59e0b','#2563eb','#ef4444','#94a3b8'];
  const entries = Object.entries(result.states);
  if (legend) legend.innerHTML = entries.map(([label,count],i) => `<div class="donut-legend-row"><span class="donut-color-dot" style="background:${colors[i%5]}"></span><span>${label.replaceAll('_',' ')} (${Math.round(count/Math.max(1,result.total)*100)}%)</span></div>`).join('') || 'Sin servicios en este período';
  const donut = document.querySelector('.donut-svg-box');
  let offset = 0;
  if (donut) donut.innerHTML = `<svg viewBox="0 0 160 160" width="160" height="160"><circle cx="80" cy="80" r="60" fill="none" stroke="#e2e8f0" stroke-width="16"/>${entries.map(([,count],i)=>{
    const pct=count/Math.max(1,result.total)*100, start=offset; offset+=pct;
    return `<circle cx="80" cy="80" r="60" pathLength="100" fill="none" stroke="${colors[i%5]}" stroke-width="16" stroke-dasharray="${pct} ${100-pct}" stroke-dashoffset="${-start}" transform="rotate(-90 80 80)"/>`;
  }).join('')}<text x="80" y="80" text-anchor="middle" font-size="24" font-weight="700">${result.total}</text><text x="80" y="102" text-anchor="middle" font-size="12">Servicios</text></svg>`;
  document.querySelectorAll('.legend-item').forEach(el => { if (el.textContent.includes('Pronóstico')) el.hidden = true; });
}
