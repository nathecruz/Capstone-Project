// Live updates for an open tab: one small answer with a version for each kind of data the app
// shows. The app asks every few seconds and fetches only what changed, whether the change came
// from this device, another device, a reminder's Done button or the admin panel.

/** The versions of the student's data (strings that change whenever the data does). */
export async function getLiveVersions(db, userId) {
  const row = (await db.query(
    `SELECT
       (SELECT COALESCE(MAX(updated_at), 0) FROM user_app_state WHERE user_id = u.id)::text AS state,
       (SELECT COALESCE(MAX(created_at), 0) || ':' || COUNT(*) FROM token_transactions WHERE user_id = u.id) AS wallet,
       (SELECT COALESCE(MAX(updated_at), 0) FROM user_buddy WHERE user_id = u.id) || ':' || (SELECT COUNT(*) FROM buddy_items WHERE user_id = u.id) AS buddy,
       (SELECT COUNT(*) FROM reward_redemptions WHERE user_id = u.id) || ':' || u.custom_title || ':' || u.profile_frame AS rewards,
       (SELECT COALESCE(MAX(created_at), 0) || ':' || COUNT(*) FILTER (WHERE read_at IS NULL) FROM notifications WHERE user_id = u.id) AS notifications,
       (SELECT COUNT(*) FILTER (WHERE read_at IS NULL) FROM notifications WHERE user_id = u.id)::int AS unread,
       (SELECT COALESCE(MAX(claimed_at), 0) FROM daily_claims WHERE user_id = u.id)::text AS claims,
       (SELECT COALESCE(MAX(updated_at), 0) FROM user_streak_freezes WHERE user_id = u.id) || ':' || (SELECT COUNT(*) FROM streak_freeze_days WHERE user_id = u.id) AS freezes
     FROM users u WHERE u.id = $1`,
    [userId],
  )).rows[0];
  if (!row) return null;
  const { unread, ...versions } = row;
  return { versions, unread: Number(unread) };
}
