// The Web Push (VAPID) key pair. Without one, a browser cannot subscribe to reminders and the
// reminder clock does not start, so web reminders silently never come. When the deployment sets
// none (WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY, WEB_PUSH_VAPID_SUBJECT), the API makes
// a pair once, keeps it in the database (server_keys) and uses it from then on, also after a
// restart: browsers subscribed with its public key keep getting reminders. Keys set in the
// deployment always win; a browser subscribed with another key subscribes again by itself
// (frontend/hooks/app-state/reminders.ts).
import webpush from 'web-push';
import { getConfiguredVapidDetails } from './web-push-reminders.js';

const KEY_NAME = 'web-push-vapid';

/** The contact a push service sees for HabitAI's pushes: a mailto: or https: address. */
export function vapidSubject(environment = process.env) {
  // EMAIL_FROM may be "HabitAI <team@example.com>".
  const email = /[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/.exec(`${environment.SUPPORT_EMAIL || ''} ${environment.EMAIL_FROM || ''}`)?.[0];
  if (email) return `mailto:${email}`;
  const url = (environment.RENDER_EXTERNAL_URL || '').trim();
  // Without either (local development), a placeholder of the reserved example.com domain.
  return /^https:\/\//.test(url) ? url : 'mailto:habitai@example.com';
}

/**
 * Makes sure this process has a VAPID key pair: the deployment's, else the one kept in the
 * database (made now when there is none). Sets them in `environment` for the code that reads them
 * there. Returns where they came from: 'environment', 'database' or 'created'.
 */
export async function ensureVapidKeys(db, { environment = process.env, generate = () => webpush.generateVAPIDKeys(), now = Date.now() } = {}) {
  if (getConfiguredVapidDetails(environment)) return 'environment';
  // A pair set without its contact: keep the pair (browsers subscribed with it), add the contact.
  if (environment.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() && environment.WEB_PUSH_VAPID_PRIVATE_KEY?.trim()) {
    environment.WEB_PUSH_VAPID_SUBJECT = vapidSubject(environment);
    return 'environment';
  }
  const read = async () => (await db.query('SELECT value_json AS "value" FROM server_keys WHERE name=$1', [KEY_NAME])).rows[0]?.value ?? null;
  let stored = await read();
  let source = 'database';
  if (!stored?.publicKey || !stored?.privateKey) {
    const keys = generate();
    // Two instances starting together keep the same pair: the first one written wins.
    await db.query('INSERT INTO server_keys(name, value_json, created_at) VALUES($1, $2, $3) ON CONFLICT (name) DO NOTHING', [KEY_NAME, { publicKey: keys.publicKey, privateKey: keys.privateKey }, now]);
    stored = await read();
    source = 'created';
  }
  environment.WEB_PUSH_VAPID_PUBLIC_KEY = stored.publicKey;
  environment.WEB_PUSH_VAPID_PRIVATE_KEY = stored.privateKey;
  if (!environment.WEB_PUSH_VAPID_SUBJECT?.trim()) environment.WEB_PUSH_VAPID_SUBJECT = vapidSubject(environment);
  return source;
}
