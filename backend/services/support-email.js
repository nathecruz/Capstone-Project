import nodemailer from 'nodemailer';
import path from 'node:path';

function isPlaceholder(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || normalized.includes('your-') || normalized.includes('replace-with') || normalized.includes('example.com');
}

export function getSupportEmailConfig(environment = process.env) {
  const user = environment.SMTP_USER?.trim() || environment.GMAIL_USER?.trim() || '';
  const password = environment.SMTP_PASSWORD?.trim() || environment.GMAIL_APP_PASSWORD?.trim() || '';
  const recipient = environment.SUPPORT_EMAIL?.trim() || user;
  const host = environment.SMTP_HOST?.trim() || '';
  const port = Number(environment.SMTP_PORT || 587);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
  return {
    user,
    password,
    recipient,
    host,
    port,
    configured: Boolean(!isPlaceholder(user) && !isPlaceholder(password) && validEmail),
  };
}

export async function forwardSupportIssue(report, environment = process.env) {
  const config = getSupportEmailConfig(environment);
  if (!config.configured) return false;

  const transport = config.host
    ? nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: String(environment.SMTP_SECURE).toLowerCase() === 'true' || config.port === 465,
      auth: { user: config.user, pass: config.password },
    })
    : nodemailer.createTransport({ service: 'gmail', auth: { user: config.user, pass: config.password } });
  const sender = environment.SMTP_FROM?.trim() || config.user;
  const attachment = report.attachmentPath
    ? [{ filename: path.basename(report.attachmentName || report.attachmentPath), path: report.attachmentPath }]
    : [];

  await transport.sendMail({
    from: `HabitAI Support <${sender}>`,
    to: config.recipient,
    ...(report.reporterEmail ? { replyTo: report.reporterEmail } : {}),
    subject: `[HabitAI issue ${report.id}] ${report.topic}`,
    text: [
      `Report ID: ${report.id}`,
      `Topic: ${report.topic}`,
      `When: ${report.timing}`,
      `Reporter: ${report.reporterEmail || 'Unknown'}`,
      '',
      report.description,
    ].join('\n'),
    attachments: attachment,
  });
  return true;
}