const pool = require('../db/pool');
function enabled() { return !pool.context.getStore()?.schema?.startsWith('empresa_'); }
function requireConfig(names) {
  if (!enabled() || names.some(name => !process.env[name]))
    throw Object.assign(new Error('Integración pendiente de configuración para esta empresa.'), {status:503});
}
module.exports = {enabled, requireConfig};
