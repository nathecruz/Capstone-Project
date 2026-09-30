import pg from 'pg';
import { loadEnvironment } from '../config/env.js';

loadEnvironment();

const { Pool, types } = pg;
types.setTypeParser(20, (value) => Number(value));

function normalizeConnectionString(value) {
  if (!value) return value;

  const url = new URL(value);
  if (['prefer', 'require', 'verify-ca'].includes(url.searchParams.get('sslmode'))) {
    url.searchParams.set('sslmode', 'verify-full');
  }
  return url.toString();
}

const connectionString = normalizeConnectionString(process.env.DATABASE_URL?.trim());
if (!connectionString) {
  throw new Error('DATABASE_URL must be configured for the Neon data layer.');
}

export const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === 'production' || connectionString.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : undefined,
  max: Number(process.env.DATABASE_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export function query(text, values = []) {
  return pool.query(text, values);
}

export async function withTransaction(callback) {
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    const result = await callback(connection);
    await connection.query('COMMIT');
    return result;
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  } finally {
    connection.release();
  }
}

export async function closeDatabase() {
  await pool.end();
}
