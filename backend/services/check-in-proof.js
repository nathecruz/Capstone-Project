// Proof for check-ins (the capstone panel: data that cannot be faked, and proof of every success).
// A habit's proof (services/habit-rules.js habitProof) says what its check-in needs:
// - timer: a Focus timer session of the habit's minutes. It starts here (POST /api/proof-sessions)
//   and the check-in is accepted once that much server time has passed since.
// - steps: a walk counted by the phone's step counter, in a session that also starts here; the
//   steps it reports must reach the habit's target and fit the time the session took (at most
//   MAX_STEPS_PER_MINUTE). Where steps cannot be counted (the web app, a phone without a step
//   counter, or motion access turned off), a photo proves the walk instead.
// - photo: a photo taken at the check-in (JPEG, PNG or WebP, at most MAX_PHOTO_BYTES). It is kept
//   for review in the Admin Panel for config.proofs.photoRetentionDays (services/retention.js).
// The app cannot see a session's start or change it, so a timer cannot be cut short; what it cannot
// prove (that the student studied while the timer ran) is listed in the app's limitations.
import crypto from 'node:crypto';

export const MAX_STEPS_PER_MINUTE = 200;
// Clocks and networks are not exact: a session may end this much early.
export const PROOF_GRACE_MS = 10_000;
export const MAX_PHOTO_BYTES = 300 * 1024;
const MIN_PHOTO_BYTES = 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Whether these bytes start like the image type they claim. */
function looksLike(bytes, type) {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/webp') return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

/**
 * Starts a timer or step session for a habit with that proof on the account's `date`, replacing an
 * earlier one of the same habit and day. Call inside the check-in transaction.
 */
export async function startProofSession(db, { userId, habitId, proof, date, now = Date.now() }) {
  const id = crypto.randomUUID();
  const target = proof.type === 'timer' ? proof.minutes : proof.steps;
  await db.query('DELETE FROM proof_sessions WHERE user_id=$1 AND habit_id=$2 AND session_date=$3', [userId, habitId, date]);
  await db.query('INSERT INTO proof_sessions(id,user_id,habit_id,session_date,kind,target,started_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, userId, habitId, date, proof.type, target, now]);
  return { sessionId: id, kind: proof.type, target, startedAt: now };
}

/** A photo sent as proof: { ok: true, record } or a refusal. */
function verifyPhoto(proof) {
  if (!proof || typeof proof.photo !== 'string' || !PHOTO_TYPES.includes(proof.type)) return { ok: false, code: 'PROOF_REQUIRED', kind: 'photo' };
  const bytes = Buffer.from(proof.photo, 'base64');
  if (bytes.length < MIN_PHOTO_BYTES || bytes.length > MAX_PHOTO_BYTES || !looksLike(bytes, proof.type)) return { ok: false, code: 'PROOF_INVALID', kind: 'photo' };
  return { ok: true, record: { kind: 'photo', photo: bytes, photoType: proof.type } };
}

/**
 * Checks the proof sent with a check-in against the habit's `required` proof. Returns
 * { ok: true, record } (record: what saveProof keeps) or { ok: false, code, ... }: PROOF_REQUIRED
 * (none, or not this habit's kind or session), PROOF_TOO_SOON (with waitSeconds) or PROOF_INVALID.
 * A walk can also be proven with a photo, for where steps cannot be counted.
 */
export async function verifyProof(db, { userId, habitId, date, required, proof, now = Date.now() }) {
  if (required.type === 'photo' || (required.type === 'steps' && typeof proof?.photo === 'string')) return verifyPhoto(proof);
  if (!proof || typeof proof.sessionId !== 'string') return { ok: false, code: 'PROOF_REQUIRED', kind: required.type };
  const session = (await db.query(
    'SELECT kind, target, started_at AS "startedAt" FROM proof_sessions WHERE id=$1 AND user_id=$2 AND habit_id=$3 AND session_date=$4',
    [proof.sessionId, userId, habitId, date],
  )).rows[0];
  if (!session || session.kind !== required.type) return { ok: false, code: 'PROOF_REQUIRED', kind: required.type };
  const startedAt = Number(session.startedAt);
  const elapsed = now - startedAt;
  if (required.type === 'timer') {
    const needed = required.minutes * 60_000 - PROOF_GRACE_MS;
    if (elapsed < needed) return { ok: false, code: 'PROOF_TOO_SOON', kind: 'timer', waitSeconds: Math.ceil((needed - elapsed) / 1000) };
    return { ok: true, record: { kind: 'timer', minutes: Math.floor(elapsed / 60_000), startedAt, sessionId: proof.sessionId } };
  }
  const steps = Number(proof.steps);
  if (!Number.isInteger(steps) || steps < required.steps) return { ok: false, code: 'PROOF_INVALID', kind: 'steps' };
  const needed = (steps / MAX_STEPS_PER_MINUTE) * 60_000 - PROOF_GRACE_MS;
  if (elapsed < needed) return { ok: false, code: 'PROOF_TOO_SOON', kind: 'steps', waitSeconds: Math.ceil((needed - elapsed) / 1000) };
  return { ok: true, record: { kind: 'steps', steps, minutes: Math.floor(elapsed / 60_000), startedAt, sessionId: proof.sessionId } };
}

/** Keeps the proof of a check-in just made, and ends its session. */
export async function saveProof(db, { userId, habitId, date, record, now = Date.now() }) {
  await db.query(
    `INSERT INTO check_in_proofs(user_id,habit_id,completed_date,kind,minutes,steps,started_at,photo,photo_type,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (user_id,habit_id,completed_date) DO UPDATE SET kind=EXCLUDED.kind, minutes=EXCLUDED.minutes, steps=EXCLUDED.steps,
       started_at=EXCLUDED.started_at, photo=EXCLUDED.photo, photo_type=EXCLUDED.photo_type, created_at=EXCLUDED.created_at`,
    [userId, habitId, date, record.kind, record.minutes ?? null, record.steps ?? null, record.startedAt ?? null, record.photo ?? null, record.photoType ?? null, now],
  );
  if (record.sessionId) await db.query('DELETE FROM proof_sessions WHERE id=$1', [record.sessionId]);
}

/** An undone check-in takes its proof with it. */
export async function deleteProof(db, { userId, habitId, date }) {
  await db.query('DELETE FROM check_in_proofs WHERE user_id=$1 AND habit_id=$2 AND completed_date=$3', [userId, habitId, date]);
}

/** The answer to a check-in refused for its proof (verifyProof's { code, kind, waitSeconds }): status and body. */
export function proofRefusal({ code, kind, waitSeconds }) {
  if (code === 'PROOF_TOO_SOON') {
    const minutes = Math.max(1, Math.ceil(waitSeconds / 60));
    const message = kind === 'timer'
      ? `The Focus timer has not run its full time yet: ${minutes} more minute${minutes === 1 ? '' : 's'}.`
      : `That many steps take longer to walk: keep going for ${minutes} more minute${minutes === 1 ? '' : 's'}.`;
    return { status: 409, body: { ok: false, code, kind, waitSeconds, message } };
  }
  if (code === 'PROOF_INVALID') {
    const message = kind === 'photo' ? 'The photo could not be read. Take it again.' : "The steps counted do not reach this habit's goal yet.";
    return { status: 400, body: { ok: false, code, kind, message } };
  }
  const how = { timer: 'finish its Focus timer', steps: 'walk its steps with HabitAI open', photo: 'take a photo of it' }[kind] ?? 'prove it';
  return { status: 409, body: { ok: false, code: 'PROOF_REQUIRED', kind, message: `This habit needs proof: ${how} to check it in.` } };
}
