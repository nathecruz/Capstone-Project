// Creates an Admin Panel account, or promotes an existing HabitAI account.
//
//   npm run create-admin -- --email admin@psau.edu.ph --first-name Maria --last-name Santos
//   npm run create-admin -- --email admin@psau.edu.ph --name "Maria Santos"          (split into first/last)
//   npm run create-admin -- --email faculty@psau.edu.ph --name "Jose Rizal" --role faculty
//   npm run create-admin -- --email existing@student.com --role admin          (promote existing)
//   npm run create-admin -- --email admin@psau.edu.ph --reset-password          (new password)
//
// Options: --username <name>  --password <value>  --save <file> (write the credentials to a file)
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { assertConfig } from '../src/config.js';
import { closePool, query } from '../src/db.js';
import { migrate } from '../src/db/migrate.js';
import { joinName, namesFromInput } from '../src/lib/names.js';
import { generatePassword, hashPassword, passwordProblem } from '../src/lib/passwords.js';
import { ROLE_LABELS, STAFF_ROLES } from '../src/lib/permissions.js';
import { availableUsername, usernameBase } from '../src/lib/usernames.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'first-name': { type: 'string' },
    'last-name': { type: 'string' },
    username: { type: 'string' },
    role: { type: 'string', default: 'admin' },
    password: { type: 'string' },
    'reset-password': { type: 'boolean', default: false },
    save: { type: 'string' },
  },
});

async function main() {
  assertConfig();
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Provide a valid --email.');
  if (!STAFF_ROLES.includes(values.role)) throw new Error(`--role must be one of: ${STAFF_ROLES.join(', ')}`);
  await migrate({ log: () => {} });

  const existing = (await query('SELECT id, full_name AS "fullName", username FROM users WHERE email = $1', [email])).rows[0];
  const names = namesFromInput({ firstName: values['first-name'], lastName: values['last-name'], fullName: values.name });
  const wantsPassword = !existing || values['reset-password'] || Boolean(values.password);
  const password = wantsPassword ? (values.password || generatePassword()) : null;
  if (password) {
    const problem = passwordProblem(password, { fullName: names.fullName || existing?.fullName, username: values.username ?? existing?.username, email });
    if (problem) throw new Error(problem);
  }

  if (existing) {
    await query(
      `UPDATE users SET role = $1, is_admin = $2, status = 'active', status_reason = '', status_changed_at = $3 WHERE id = $4`,
      [values.role, values.role === 'admin', Date.now(), existing.id],
    );
    if (password) {
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), existing.id]);
      await query('DELETE FROM sessions WHERE user_id = $1', [existing.id]);
    }
    console.log(`Updated ${email}: role is now ${ROLE_LABELS[values.role]}.`);
  } else {
    if (!names.firstName || !names.lastName) throw new Error('Provide --first-name and --last-name (or --name "First Last") for a new account.');
    const fullName = joinName(names.firstName, names.lastName);
    const username = await availableUsername(query, usernameBase(values.username || email.split('@')[0]));
    await query(
      `INSERT INTO users (id, full_name, username, email, date_of_birth, gender, region, about, password_hash, created_at, role, status, is_admin, status_changed_at, email_verified_at, first_name, last_name)
       VALUES ($1, $2, $3, $4, '', '', '', '', $5, $6, $7, 'active', $8, $6, $6, $9, $10)`,
      [crypto.randomUUID(), fullName, username, email, await hashPassword(password), Date.now(), values.role, values.role === 'admin', names.firstName, names.lastName],
    );
    console.log(`Created ${ROLE_LABELS[values.role]} account ${email} (username: ${username}).`);
  }

  await query(
    `INSERT INTO admin_audit_log(id, actor_email, action, target_type, summary, created_at)
     VALUES ($1, 'cli', 'user.cli_provisioned', 'user', $2, $3)`,
    [crypto.randomUUID(), `CLI provisioned ${email} as ${ROLE_LABELS[values.role]}`, Date.now()],
  );

  if (password && !values.password) {
    if (values.save) {
      writeFileSync(values.save, `Admin Panel sign-in\nEmail: ${email}\nPassword: ${password}\n\nChange this password after signing in (Settings > My account), then delete this file.\n`, { mode: 0o600 });
      console.log(`Temporary password saved to ${values.save}`);
    } else {
      console.log(`Temporary password: ${password}`);
      console.log('Sign in and change it from Settings > My account.');
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`[create-admin] ${error.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
