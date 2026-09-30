import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { query, withTransaction } from '../db.js';
import { defaultCategories, defaultTemplates, defaultSettings } from './seed-data.js';

async function hasCurrentSchema(schemaHash) {
  const exists = await query("SELECT to_regclass('public.admin_settings') AS name");
  if (!exists.rows[0]?.name) return false;
  const stored = await query("SELECT value FROM admin_settings WHERE key = 'schema_hash'");
  return stored.rows[0]?.value === schemaHash;
}

async function seedOnce(client, flag, seed) {
  const seeded = await client.query('SELECT 1 FROM admin_settings WHERE key = $1', [flag]);
  if (seeded.rowCount) return false;
  await seed();
  await client.query(
    'INSERT INTO admin_settings(key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
    [flag, JSON.stringify(true), Date.now()],
  );
  return true;
}

export async function migrate({ force = false, log = console.log } = {}) {
  const baseTables = await query("SELECT to_regclass('public.users') AS users, to_regclass('public.habits') AS habits");
  if (!baseTables.rows[0]?.users || !baseTables.rows[0]?.habits) {
    throw new Error('HabitAI app tables were not found. Run the app backend migration (npm run db:migrate:neon) first.');
  }

  const schema = await readFile(new URL('./admin-schema.sql', import.meta.url), 'utf8');
  const schemaHash = crypto.createHash('sha256').update(schema).digest('hex');
  if (!force && await hasCurrentSchema(schemaHash)) {
    log('[migrate] admin schema is up to date');
    return { applied: false };
  }

  await withTransaction(async (client) => {
    await client.query(schema);
    const now = Date.now();

    const categoriesSeeded = await seedOnce(client, 'seed:habit_categories', async () => {
      for (const [index, category] of defaultCategories.entries()) {
        await client.query(
          `INSERT INTO habit_categories(id, label, icon, color, description, sort_order, is_active, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $7) ON CONFLICT DO NOTHING`,
          [category.id, category.label, category.icon, category.color, category.description, index, now],
        );
      }
    });

    const templatesSeeded = await seedOnce(client, 'seed:notification_templates', async () => {
      for (const template of defaultTemplates) {
        await client.query(
          `INSERT INTO notification_templates(id, name, type, title, body, description, is_active, is_system, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $8) ON CONFLICT DO NOTHING`,
          [template.id, template.name, template.type, template.title, template.body, template.description, template.isSystem, now],
        );
      }
    });

    for (const [key, value] of Object.entries(defaultSettings)) {
      await client.query(
        'INSERT INTO admin_settings(key, value, updated_at) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING',
        [key, JSON.stringify(value), now],
      );
    }

    await client.query(
      `INSERT INTO admin_settings(key, value, updated_at) VALUES ('schema_hash', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(schemaHash), now],
    );

    if (categoriesSeeded) log('[migrate] seeded default habit categories');
    if (templatesSeeded) log('[migrate] seeded default notification templates');
  });

  log('[migrate] admin schema applied');
  return { applied: true };
}
