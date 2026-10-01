// Admin Panel access requests. Anyone can ask for access from the sign-in page (POST /api/auth/register);
// a System Administrator approves a request here, which creates the account, or rejects it.
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, validate } from '../lib/http.js';
import { joinName } from '../lib/names.js';
import { ROLE_LABELS } from '../lib/permissions.js';
import { availableUsername, usernameBase } from '../lib/usernames.js';
import { requirePermission } from '../middleware/auth.js';

/** Roles someone may ask for; students sign up in the mobile app instead. */
export const REQUEST_ROLES = ['faculty', 'admin'];
/** Requests nobody acted on are dropped after 30 days. */
export const REQUEST_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Upper bound on waiting requests, so the public form cannot fill the table. */
export const MAX_PENDING_REQUESTS = 50;

export function purgeExpiredRequests(now = Date.now()) {
  return query('DELETE FROM admin_access_requests WHERE created_at < $1', [now - REQUEST_TTL_MS]);
}

const router = Router();
router.use(requirePermission('users:manage'));

router.get('/', async (_request, response) => {
  await purgeExpiredRequests();
  const { rows } = await query(
    `SELECT id, first_name AS "firstName", last_name AS "lastName", email, requested_role AS "requestedRole", reason, created_at AS "createdAt"
       FROM admin_access_requests
      ORDER BY created_at`,
  );
  response.json({
    ok: true,
    items: rows.map((row) => ({ ...row, fullName: joinName(row.firstName, row.lastName), requestedRoleLabel: ROLE_LABELS[row.requestedRole] })),
  });
});

const approveSchema = z.object({ role: z.enum(REQUEST_ROLES) }).strict();

router.post('/:id/approve', async (request, response) => {
  const { role } = validate(approveSchema, request.body);
  const userId = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", email, password_hash AS "passwordHash", requested_role AS "requestedRole"
         FROM admin_access_requests WHERE id = $1 FOR UPDATE`,
      [request.params.id],
    );
    const accessRequest = rows[0];
    if (!accessRequest) throw new HttpError(404, 'This request was already approved or rejected.');
    const taken = await client.query('SELECT 1 FROM users WHERE email = $1', [accessRequest.email]);
    if (taken.rowCount) {
      throw new HttpError(409, 'An account with this email already exists. Reject this request and change that account’s role from the Users list instead.');
    }

    const id = crypto.randomUUID();
    const fullName = joinName(accessRequest.firstName, accessRequest.lastName);
    const username = await availableUsername(client.query.bind(client), usernameBase(accessRequest.email.split('@')[0]));
    // The administrator's approval stands in for email verification, as with accounts they create.
    await client.query(
      `INSERT INTO users (id, full_name, username, email, date_of_birth, gender, region, about, password_hash, created_at, role, status, is_admin, status_changed_at, email_verified_at, first_name, last_name)
       VALUES ($1, $2, $3, $4, '', '', '', '', $5, $6, $7, 'active', $8, $6, $6, $9, $10)`,
      [id, fullName, username, accessRequest.email, accessRequest.passwordHash, Date.now(), role, role === 'admin', accessRequest.firstName, accessRequest.lastName],
    );
    await client.query('DELETE FROM admin_access_requests WHERE id = $1', [accessRequest.id]);
    await audit(request, {
      action: 'access_request.approved',
      targetType: 'user',
      targetId: id,
      summary: `Approved ${accessRequest.email} as ${ROLE_LABELS[role]}`,
      details: { email: accessRequest.email, requestedRole: accessRequest.requestedRole, role },
    }, client);
    return id;
  });
  response.status(201).json({ ok: true, userId });
});

router.delete('/:id', async (request, response) => {
  const { rows } = await query('DELETE FROM admin_access_requests WHERE id = $1 RETURNING email', [request.params.id]);
  if (!rows[0]) throw new HttpError(404, 'This request was already approved or rejected.');
  await audit(request, {
    action: 'access_request.rejected',
    targetType: 'access_request',
    targetId: request.params.id,
    summary: `Rejected the access request from ${rows[0].email}`,
    details: { email: rows[0].email },
  });
  response.json({ ok: true });
});

export default router;
