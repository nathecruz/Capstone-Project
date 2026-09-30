import path from 'node:path';
import { getEmailConfig, sendEmail } from './mailer.js';

export function getSupportEmailConfig(environment = process.env) {
  const mail = getEmailConfig(environment);
  const recipient = environment.SUPPORT_EMAIL?.trim() || mail.user;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
  return {
    user: mail.user,
    password: mail.password,
    recipient,
    host: mail.host,
    port: mail.port,
    configured: mail.configured && validEmail,
  };
}

/** Emails an issue report to the support inbox. Returns false when email is not configured. */
export async function forwardSupportIssue(report, environment = process.env) {
  const config = getSupportEmailConfig(environment);
  if (!config.configured) return false;

  const attachments = report.attachmentPath
    ? [{ filename: path.basename(report.attachmentName || report.attachmentPath), path: report.attachmentPath }]
    : [];

  await sendEmail({
    fromName: 'HabitAI Support',
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
    attachments,
  }, environment);
  return true;
}
