// Transactional email content. Every template returns { subject, text, html }.
// All interpolated values are HTML-escaped; the plain-text part is the fallback for every client.

const BRAND = '#5B42D8';

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || 'there';
}

function layout({ preheader, heading, body }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f3f8;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1b26;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f3f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:${BRAND};padding:20px 28px;color:#ffffff;font-size:20px;font-weight:700;">HabitAI</td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${escapeHtml(heading)}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#faf9fd;color:#77738a;font-size:12px;line-height:1.5;">
          This is an automated message from HabitAI. Please do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function passwordResetCodeEmail({ name, code, minutes }) {
  const greeting = `Hello ${firstName(name)},`;
  return {
    subject: `${code} is your HabitAI verification code`,
    text: [
      greeting,
      '',
      `Your HabitAI password reset code is: ${code}`,
      `It expires in ${minutes} minutes and can only be used once.`,
      '',
      'If you did not request a password reset, ignore this email. Your password will not change.',
      'Never share this code with anyone, including people claiming to be from HabitAI.',
    ].join('\n'),
    html: layout({
      preheader: `Your verification code expires in ${minutes} minutes.`,
      heading: 'Reset your password',
      body: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Use this code in the HabitAI app to reset your password:</p>
        <p style="margin:0 0 16px;text-align:center;">
          <span style="display:inline-block;padding:14px 24px;border-radius:12px;background:#f1eefc;color:${BRAND};font-size:32px;font-weight:700;letter-spacing:8px;font-family:Consolas,Menlo,monospace;">${escapeHtml(code)}</span>
        </p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4d4960;">It expires in <strong>${escapeHtml(minutes)} minutes</strong> and can only be used once.</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#77738a;">If you did not request a password reset, you can ignore this email and your password will stay the same. Never share this code with anyone.</p>`,
    }),
  };
}

export function emailVerificationCodeEmail({ name, code, minutes }) {
  const greeting = `Hello ${firstName(name)},`;
  return {
    subject: `${code} is your HabitAI email verification code`,
    text: [
      greeting,
      '',
      `Welcome to HabitAI! Your email verification code is: ${code}`,
      `It expires in ${minutes} minutes.`,
      '',
      'If you did not create a HabitAI account, you can ignore this email.',
    ].join('\n'),
    html: layout({
      preheader: `Confirm your email to start using HabitAI. The code expires in ${minutes} minutes.`,
      heading: 'Confirm your email',
      body: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Welcome to HabitAI! Enter this code in the app to confirm your email address:</p>
        <p style="margin:0 0 16px;text-align:center;">
          <span style="display:inline-block;padding:14px 24px;border-radius:12px;background:#f1eefc;color:${BRAND};font-size:32px;font-weight:700;letter-spacing:8px;font-family:Consolas,Menlo,monospace;">${escapeHtml(code)}</span>
        </p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#4d4960;">It expires in <strong>${escapeHtml(minutes)} minutes</strong>.</p>
        <p style="margin:0;font-size:13px;line-height:1.6;color:#77738a;">If you did not create a HabitAI account, you can ignore this email.</p>`,
    }),
  };
}

export function passwordChangedEmail({ name, when = new Date(), timeZone = 'Asia/Manila' }) {
  const formatted = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(when);
  const greeting = `Hello ${firstName(name)},`;
  return {
    subject: 'Your HabitAI password was changed',
    text: [
      greeting,
      '',
      `The password for your HabitAI account was changed on ${formatted}.`,
      'For your security, you were signed out of your other devices.',
      '',
      'If this was not you, reset your password right away from the HabitAI sign-in screen and contact support.',
    ].join('\n'),
    html: layout({
      preheader: 'Security notice for your HabitAI account.',
      heading: 'Your password was changed',
      body: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">The password for your HabitAI account was changed on <strong>${escapeHtml(formatted)}</strong>. For your security, you were signed out of your other devices.</p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#4d4960;">If this was not you, reset your password right away from the HabitAI sign-in screen and contact support.</p>`,
    }),
  };
}

/** The account's email address was changed: sent to the old address. */
export function emailChangedEmail({ name, newEmail, when = new Date(), timeZone = 'Asia/Manila' }) {
  const formatted = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(when);
  const greeting = `Hello ${firstName(name)},`;
  return {
    subject: 'Your HabitAI email address was changed',
    text: [
      greeting,
      '',
      `The email address of your HabitAI account was changed to ${newEmail} on ${formatted}.`,
      'Messages about your account now go to the new address.',
      '',
      'If this was not you, contact support right away so the account can be secured.',
    ].join('\n'),
    html: layout({
      preheader: 'Security notice for your HabitAI account.',
      heading: 'Your email address was changed',
      body: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">The email address of your HabitAI account was changed to <strong>${escapeHtml(newEmail)}</strong> on <strong>${escapeHtml(formatted)}</strong>. Messages about your account now go to the new address.</p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#4d4960;">If this was not you, contact support right away so the account can be secured.</p>`,
    }),
  };
}

/** Sign-in was paused after too many wrong passwords. */
export function signInPausedEmail({ name, minutes, when = new Date(), timeZone = 'Asia/Manila' }) {
  const formatted = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(when);
  const greeting = `Hello ${firstName(name)},`;
  return {
    subject: 'Sign-in to your HabitAI account was paused',
    text: [
      greeting,
      '',
      `On ${formatted}, someone entered the wrong password for your HabitAI account several times in a row.`,
      `To protect your account, sign-in is paused for ${minutes} minutes.`,
      '',
      'If this was you, wait and try again, or use "Forgot password" on the sign-in screen.',
      'If this was not you, your account is still safe. Consider changing your password to one you do not use anywhere else.',
    ].join('\n'),
    html: layout({
      preheader: 'Security notice for your HabitAI account.',
      heading: 'Sign-in was paused',
      body: `
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6;">On <strong>${escapeHtml(formatted)}</strong>, someone entered the wrong password for your HabitAI account several times in a row. To protect your account, sign-in is paused for <strong>${escapeHtml(String(minutes))} minutes</strong>.</p>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#4d4960;">If this was you, wait and try again, or use <strong>Forgot password</strong> on the sign-in screen.</p>
        <p style="margin:0;font-size:14px;line-height:1.6;color:#4d4960;">If this was not you, your account is still safe. Consider changing your password to one you do not use anywhere else.</p>`,
    }),
  };
}
