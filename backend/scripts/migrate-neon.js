import '../config/index.js';
import { closeDatabase, query } from '../db/client.js';
import { ensureNeonSchema } from '../db/neon-schema.js';

try {
  await ensureNeonSchema({ log: console.log });
  const result = await query(`
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`Neon schema ready: ${result.rows.map((row) => row.name).join(', ')}`);
  const catalogs = await query(`
    SELECT
      (SELECT COUNT(*)::integer FROM achievements) AS achievements,
      (SELECT COUNT(*)::integer FROM rewards) AS rewards
  `);
  console.log(`Catalog rows ready: ${catalogs.rows[0].achievements} achievements, ${catalogs.rows[0].rewards} rewards`);
} finally {
  await closeDatabase();
}
