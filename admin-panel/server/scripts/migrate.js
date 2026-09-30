import { assertConfig } from '../src/config.js';
import { closePool } from '../src/db.js';
import { migrate } from '../src/db/migrate.js';

try {
  assertConfig();
  await migrate({ force: true });
} catch (error) {
  console.error('[migrate] failed:', error.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
