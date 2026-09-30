import crypto from 'node:crypto';

/** Validates the JSON body; on failure sends a 400 and returns null. */
export function parse(schema, request, response) {
  const result = schema.safeParse(request.body ?? {});
  if (!result.success) {
    response.status(400).json({ ok: false, message: 'Request contains invalid or unsupported fields.', issues: result.error.issues });
    return null;
  }
  return result.data;
}

export function normalizeEmail(value) {
  return String(value).trim().toLowerCase();
}

export function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function authToken(request) {
  const header = request.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** First day (UTC) of the leaderboard period. */
export function getPeriodStart(period, now = new Date()) {
  if (period === 'This Month') return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const mondayOffset = (now.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset));
  return start.toISOString().slice(0, 10);
}
