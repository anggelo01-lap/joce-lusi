const { Pool } = require('pg');
const raw = new Pool({
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'platinum_orion',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD
});
const { AsyncLocalStorage } = require('node:async_hooks');
const context = new AsyncLocalStorage();
async function connect() {
  const client = await raw.connect();
  try {
    const schema = context.getStore()?.schema || 'public';
    if (!/^(public|empresa_[1-9]\d*)$/.test(schema)) throw new Error('Empresa inválida.');
    await client.query(`SET search_path TO "${schema}"`);
    return client;
  } catch (error) { client.release(); throw error; }
}
module.exports = {
  raw, context, connect,
  async query(...args) { const client = await connect(); try { return await client.query(...args); } finally { client.release(); } },
  end: () => raw.end()
};
