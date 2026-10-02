import { readFile } from 'node:fs/promises';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { isTemplateValue } from '../config/env.js';

// Two ways to send: Brevo's HTTPS API (BREVO_API_KEY) or SMTP (SMTP_*). Free Render web
// services block outbound SMTP ports 25, 465 and 587, so production uses the HTTPS API.
const BREVO_API = 'https://api.brevo.com/v3';
const API_TIMEOUT_MS = 15000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Email settings: BREVO_API_KEY wins over SMTP_* (with the legacy GMAIL_* names as fallback). */
export function getEmailConfig(environment = process.env) {
  const user = environment.SMTP_USER?.trim() || environment.GMAIL_USER?.trim() || '';
  const password = environment.SMTP_PASSWORD?.trim() || environment.GMAIL_APP_PASSWORD?.trim() || '';
  const host = environment.SMTP_HOST?.trim() || '';
  const port = Number(environment.SMTP_PORT || 587);
  const secure = String(environment.SMTP_SECURE).toLowerCase() === 'true' || port === 465;
  const apiKey = environment.BREVO_API_KEY?.trim() || '';
  // The API needs a sender verified in Brevo; SMTP falls back to the login address.
  const sender = environment.EMAIL_FROM?.trim() || environment.SMTP_FROM?.trim() || user;
  const smtpReady = Boolean(user && password && !isTemplateValue(user) && !isTemplateValue(password));
  const apiReady = Boolean(apiKey && !isTemplateValue(apiKey) && EMAIL_PATTERN.test(sender) && !isTemplateValue(sender));
  const provider = apiReady ? 'brevo' : smtpReady ? 'smtp' : 'none';
  return { provider, user, password, host, port, secure, sender, apiKey, configured: provider !== 'none' };
}

const transports = new Map();

/** One pooled SMTP connection per configuration instead of a new login for every email. */
export function getTransport(config = getEmailConfig()) {
  if (config.provider !== 'smtp') return null;
  const key = `${config.host}|${config.port}|${config.user}`;
  if (!transports.has(key)) {
    const auth = { user: config.user, pass: config.password };
    transports.set(key, config.host
      ? nodemailer.createTransport({ pool: true, maxConnections: 2, host: config.host, port: config.port, secure: config.secure, auth })
      : nodemailer.createTransport({ pool: true, maxConnections: 2, service: 'gmail', auth }));
  }
  return transports.get(key);
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Email delivery is not configured on the server.');
    this.code = 'EMAIL_NOT_CONFIGURED';
  }
}

function brevoRequest(config, pathname, init = {}) {
  return fetch(`${BREVO_API}${pathname}`, {
    ...init,
    headers: { accept: 'application/json', 'api-key': config.apiKey, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
}

/** Nodemailer-style attachments ({ filename, path } or { filename, content }) as Brevo's base64 items. */
async function brevoAttachments(attachments = []) {
  return Promise.all(attachments.map(async (item) => {
    const content = item.path ? await readFile(item.path) : Buffer.from(item.content ?? '');
    return { name: item.filename || path.basename(item.path || 'attachment'), content: content.toString('base64') };
  }));
}

async function sendWithBrevo(config, { fromName, to, subject, text, html, replyTo, attachments }) {
  const body = {
    sender: { name: fromName, email: config.sender },
    to: [{ email: to }],
    subject,
    // Brevo needs an HTML part; plain-text-only messages are wrapped as preformatted text.
    htmlContent: html || `<pre style="font-family:inherit;white-space:pre-wrap">${String(text ?? '').replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character])}</pre>`,
    ...(text ? { textContent: text } : {}),
    ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    ...(attachments?.length ? { attachment: await brevoAttachments(attachments) } : {}),
  };
  const response = await brevoRequest(config, '/smtp/email', { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const error = new Error(`Brevo rejected the email (${response.status}): ${detail.slice(0, 300)}`);
    error.code = `BREVO_${response.status}`;
    throw error;
  }
  return response.json().catch(() => ({}));
}

/** Sends a message; `message` is { to, subject, text, html?, replyTo?, attachments?, fromName? }. */
export async function sendEmail(message, environment = process.env) {
  const config = getEmailConfig(environment);
  const { fromName = 'HabitAI', ...rest } = message;
  if (config.provider === 'brevo') return sendWithBrevo(config, { fromName, ...rest });
  const transport = getTransport(config);
  if (!transport) throw new EmailNotConfiguredError();
  return transport.sendMail({ from: `${fromName} <${config.sender}>`, ...rest });
}

/** Logs whether the email settings work, without sending anything. */
export async function verifyMailer(log = console) {
  const config = getEmailConfig();
  if (config.provider === 'none') {
    if (process.env.BREVO_API_KEY?.trim()) log.warn('[mail] BREVO_API_KEY is set but EMAIL_FROM is not a valid sender address.');
    log.warn('[mail] Email is not configured: verification and password reset emails are disabled.');
    return false;
  }
  try {
    if (config.provider === 'brevo') {
      const response = await brevoRequest(config, '/account');
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: response.status === 401 ? 'INVALID_API_KEY' : `HTTP_${response.status}` });
      log.info(`[mail] Brevo API key verified; sending as ${config.sender}.`);
      return true;
    }
    await getTransport(config).verify();
    log.info('[mail] SMTP connection verified.');
    return true;
  } catch (error) {
    const reason = error?.responseCode ?? error?.code ?? 'error';
    log.error(config.provider === 'brevo'
      ? `[mail] Brevo check failed (${reason}). Check BREVO_API_KEY in the Render dashboard.`
      : `[mail] SMTP login failed (${reason}). On Render's free plan SMTP ports are blocked: set BREVO_API_KEY and EMAIL_FROM instead.`);
    return false;
  }
}
