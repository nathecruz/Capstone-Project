// Retention rules, kept free of the shared pool so tests can run them against their own schema.
const DAY_MS = 24 * 60 * 60 * 1000;

/** Issue-report screenshots/videos are kept while the report is worked on, then dropped. */
export const ATTACHMENT_RETENTION = { afterResolvedDays: 30, maxDays: 180 };

/** Clears attachment bytes (the file name stays, so the report still shows one existed). */
export async function pruneIssueAttachments(runner, now = Date.now()) {
  const result = await runner.query(`
    UPDATE issue_reports SET attachment_data = NULL
    WHERE attachment_data IS NOT NULL
      AND ((status IN ('resolved', 'closed') AND COALESCE(updated_at, created_at) < $1) OR created_at < $2)
  `, [now - ATTACHMENT_RETENTION.afterResolvedDays * DAY_MS, now - ATTACHMENT_RETENTION.maxDays * DAY_MS]);
  return result.rowCount || 0;
}

/** Expired one-time codes are useless a day later; keeping them a day preserves "code expired" messages. */
export async function pruneExpiredCodes(runner, now = Date.now()) {
  await runner.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
  await runner.query('DELETE FROM password_reset_requests WHERE expires_at < $1', [now - DAY_MS]);
  await runner.query('DELETE FROM email_verification_codes WHERE expires_at < $1', [now - DAY_MS]);
}

/** Weekly due marks are only read for last week's bonus and this week (services/weekly-bonus.js). */
export const DUE_MARK_RETENTION_DAYS = 28;

/** Drops the due marks of weeks that started over 4 weeks ago; returns how many. */
export async function pruneDueMarks(runner, now = Date.now()) {
  const result = await runner.query('DELETE FROM weekly_due_marks WHERE week_start < $1::date', [new Date(now - DUE_MARK_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10)]);
  return result.rowCount || 0;
}

/** Photo proofs of check-ins (services/check-in-proof.js) are reviewed soon after; the record of the proof stays. */
export async function prunePhotoProofs(runner, retentionDays, now = Date.now()) {
  const result = await runner.query('UPDATE check_in_proofs SET photo = NULL, photo_type = NULL WHERE photo IS NOT NULL AND created_at < $1', [now - retentionDays * DAY_MS]);
  return result.rowCount || 0;
}

/** A Focus timer or walk session is for its day: the ones never finished are dropped after two days. */
export async function pruneProofSessions(runner, now = Date.now()) {
  const result = await runner.query('DELETE FROM proof_sessions WHERE started_at < $1', [now - 2 * DAY_MS]);
  return result.rowCount || 0;
}
