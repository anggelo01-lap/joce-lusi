const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const analytics = require('../../frontend/presentacion-analitica');

function render(services, days = 7) {
  const charts = [{}, {}], legend = {}, donut = {};
  const context = vm.createContext({
    PlatinumAnalitica: analytics, appState: {servicios: services},
    document: {
      querySelectorAll: selector => selector.includes('chart-svg') ? charts : [],
      querySelector: selector => selector.includes('legend-list') ? legend : donut
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../frontend/operativo-charts.js'), 'utf8'), context);
  vm.runInContext(`renderOperationalCharts(${days})`, context);
  return {charts, legend, donut};
}
test('empty dashboard renders zero services without invented percentages', () => {
  const {charts,legend,donut} = render([]);
  assert.match(legend.innerHTML, /Sin servicios/);
  assert.match(donut.innerHTML, />0<\/text>/);
  assert.ok(charts.every(c => !/NaN|undefined/.test(c.innerHTML)));
});
test('period selection changes chart and distribution from loaded records', () => {
  const date = new Date(); date.setDate(date.getDate()-10);
  const services = [{estado:'COMPLETADO',tarifa:0,creado_en:date.toISOString()}];
  assert.match(render(services,7).legend.innerHTML, /Sin servicios/);
  const result = render(services,30);
  assert.match(result.legend.innerHTML, /COMPLETADO \(100%\)/);
  assert.match(result.charts[0].innerHTML, /30 d/);
});
