import crypto from 'node:crypto';
import { query } from '../db.js';
import { clientIp } from './http.js';

export async function audit(request, { action, targetType = '', targetId = null, summary = '', details = {} }, runner = null) {
  const actor = request.admin;
  const run = runner ? runner.query.bind(runner) : query;
  try {
    await run(
      `INSERT INTO admin_audit_log(id, actor_id, actor_email, action, target_type, target_id, summary, details, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        crypto.randomUUID(),
        actor?.id ?? null,
        actor?.email ?? details.email ?? '',
        action,
        targetType,
        targetId,
        summary,
        JSON.stringify(details),
        clientIp(request),
        Date.now(),
      ],
    );
  } catch (error) {
    if (runner) throw error;
    console.error('[audit] failed to record', action, error.message);
  }
}
