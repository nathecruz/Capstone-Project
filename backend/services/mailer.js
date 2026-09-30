import nodemailer from 'nodemailer';
import { isTemplateValue } from '../config/env.js';

/** SMTP settings (SMTP_* with the legacy GMAIL_* names as fallback). */
export function getEmailConfig(environment = process.env) {
  const user = environment.SMTP_USER?.trim() || environment.GMAIL_USER?.trim() || '';
  const password = environment.SMTP_PASSWORD?.trim() || environment.GMAIL_APP_PASSWORD?.trim() || '';
  const host = environment.SMTP_HOST?.trim() || '';
  const port = Number(environment.SMTP_PORT || 587);
  const secure = String(environment.SMTP_SECURE).toLowerCase() === 'true' || port === 465;
  const sender = environment.SMTP_FROM?.trim() || user;
  return {
    user,
    password,
    host,
    port,
    secure,
    sender,
    configured: Boolean(user && password && !isTemplateValue(user) && !isTemplateValue(password)),
  };
}

const transports = new Map();

/** One pooled SMTP connection per configuration instead of a new login for every email. */
export function getTransport(config = getEmailConfig()) {
  if (!config.configured) return null;
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

/** Sends a message; `message` is { to, subject, text, html?, replyTo?, attachments?, fromName? }. */
export async function sendEmail(message, environment = process.env) {
  const config = getEmailConfig(environment);
  const transport = getTransport(config);
  if (!transport) throw new EmailNotConfiguredError();
  const { fromName = 'HabitAI', ...rest } = message;
  return transport.sendMail({ from: `${fromName} <${config.sender}>`, ...rest });
}

/** Logs whether SMTP credentials work, without sending anything. */
export async function verifyMailer(log = console) {
  const transport = getTransport();
  if (!transport) {
    log.warn('[mail] SMTP is not configured: password reset emails are disabled.');
    return false;
  }
  try {
    await transport.verify();
    log.info('[mail] SMTP connection verified.');
    return true;
  } catch (error) {
    log.error(`[mail] SMTP login failed (${error?.responseCode ?? error?.code ?? 'error'}). For Gmail use a 16-character App Password.`);
    return false;
  }
}
