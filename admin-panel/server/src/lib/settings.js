import { query } from '../db.js';
import { defaultSettings } from '../db/seed-data.js';

export async function getSettings() {
  const result = await query('SELECT key, value FROM admin_settings WHERE key = ANY($1::text[])', [Object.keys(defaultSettings)]);
  const stored = Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  return {
    anonymityThreshold: Number(stored.anonymity_threshold ?? defaultSettings.anonymity_threshold),
    inactiveDays: Number(stored.inactive_days ?? defaultSettings.inactive_days),
  };
}

export async function saveSetting(key, value, userId) {
  await query(
    `INSERT INTO admin_settings(key, value, updated_by, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [key, JSON.stringify(value), userId, Date.now()],
  );
}
