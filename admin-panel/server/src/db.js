import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;
// BIGINT (epoch-millisecond columns) and NUMERIC aggregates come back as JS numbers.
types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));
// DATE stays a plain 'YYYY-MM-DD' string so no time-zone shifting happens in JS.
types.setTypeParser(1082, (value) => value);

export function buildPoolConfig(rawUrl) {
  const url = new URL(rawUrl);
  const sslMode = url.searchParams.get('sslmode');
  const channelBinding = url.searchParams.get('channel_binding');
  url.searchParams.delete('sslmode');
  url.searchParams.delete('channel_binding');
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  const sslDisabled = sslMode === 'disable' || (isLocal && !sslMode);

  return {
    connectionString: url.toString(),
    // Neon serves publicly trusted certificates, so the certificate is always verified.
    ssl: sslDisabled ? false : { rejectUnauthorized: true },
    enableChannelBinding: !sslDisabled && (channelBinding === 'require' || channelBinding === 'prefer'),
    max: config.databasePoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  };
}

let pool;

export function getPool() {
  if (!pool) {
    pool = new Pool(buildPoolConfig(config.databaseUrl));
    pool.on('error', (error) => console.error('[db] idle client error:', error.message));
  }
  return pool;
}

export function query(text, values = []) {
  return getPool().query(text, values);
}

export async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
