import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import webpush from 'web-push';

const backendDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const backendEnvPath = path.join(backendDirectory, '.env');
const rootEnvPath = path.resolve(backendDirectory, '..', '.env');

function isPlaceholder(value) {
	return !value || /replace-with|your-|example\.com|localhost/i.test(value);
}

function setEnvValue(contents, key, value) {
	const newline = contents.includes('\r\n') ? '\r\n' : '\n';
	const lines = contents ? contents.split(/\r?\n/) : [];
	const existingLine = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
	if (existingLine >= 0) lines[existingLine] = `${key}=${value}`;
	else lines.push(`${key}=${value}`);
	return lines.join(newline).replace(new RegExp(`${newline}*$`), `${newline}`);
}

async function configureLocalEnvironment() {
	let backendContents = '';
	let rootContents = '';
	try { backendContents = await readFile(backendEnvPath, 'utf8'); } catch {}
	try { rootContents = await readFile(rootEnvPath, 'utf8'); } catch {}
	const backendValues = dotenv.parse(backendContents);
	const rootValues = dotenv.parse(rootContents);
	const values = { ...backendValues };

	const smtpKeys = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
	for (const key of smtpKeys) {
		const rootValue = rootValues[key]?.trim();
		if (isPlaceholder(values[key]?.trim()) && !isPlaceholder(rootValue)) values[key] = rootValue;
	}

	const usableSmtpUser = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.SMTP_USER || '') && !isPlaceholder(values.SMTP_USER);
	const usableSmtpPassword = Boolean(values.SMTP_PASSWORD && values.SMTP_PASSWORD.length >= 12 && !isPlaceholder(values.SMTP_PASSWORD));
	if (usableSmtpUser && usableSmtpPassword && isPlaceholder(values.SMTP_FROM)) values.SMTP_FROM = values.SMTP_USER;
	if (isPlaceholder(values.WEB_PUSH_VAPID_PUBLIC_KEY) || isPlaceholder(values.WEB_PUSH_VAPID_PRIVATE_KEY)) {
		const vapidKeys = webpush.generateVAPIDKeys();
		values.WEB_PUSH_VAPID_PUBLIC_KEY = vapidKeys.publicKey;
		values.WEB_PUSH_VAPID_PRIVATE_KEY = vapidKeys.privateKey;
	}
	if (isPlaceholder(values.WEB_PUSH_VAPID_SUBJECT)) {
		values.WEB_PUSH_VAPID_SUBJECT = usableSmtpUser ? `mailto:${values.SMTP_USER}` : 'mailto:developer@localhost';
	}
	if (isPlaceholder(values.WEB_PUSH_API_URL)) values.WEB_PUSH_API_URL = 'http://localhost:8787';

	for (const key of [...smtpKeys, 'SUPPORT_EMAIL', 'WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'WEB_PUSH_VAPID_SUBJECT', 'WEB_PUSH_API_URL']) {
		if (values[key]) backendContents = setEnvValue(backendContents, key, values[key]);
	}
	await writeFile(backendEnvPath, backendContents, { encoding: 'utf8', mode: 0o600 });
	console.log(`Local backend environment configured at ${path.relative(process.cwd(), backendEnvPath)}. VAPID private key was not printed.`);
	console.log(`SMTP forwarding: ${usableSmtpUser && usableSmtpPassword ? 'configured' : 'requires valid SMTP credentials'}.`);
}

async function verifySmtpCredentials() {
	let contents = '';
	try { contents = await readFile(backendEnvPath, 'utf8'); } catch {}
	const values = dotenv.parse(contents);
	const user = values.SMTP_USER || values.GMAIL_USER;
	const password = values.SMTP_PASSWORD || values.GMAIL_APP_PASSWORD;
	const host = values.SMTP_HOST;
	const port = Number(values.SMTP_PORT || 587);
	if (!user || !password || !host) {
		console.log('SMTP verification skipped: backend SMTP configuration is incomplete.');
		process.exitCode = 1;
		return;
	}

	const transport = nodemailer.createTransport({
		host,
		port,
		secure: String(values.SMTP_SECURE).toLowerCase() === 'true' || port === 465,
		auth: { user, pass: password },
		connectionTimeout: 5000,
		greetingTimeout: 5000,
		socketTimeout: 8000,
	});
	try {
		await transport.verify();
		console.log('SMTP verification passed. No email was sent.');
	} catch {
		console.log('SMTP verification failed. Check provider credentials and network access. No email was sent.');
		process.exitCode = 1;
	} finally {
		transport.close();
	}
}

if (process.argv.includes('--verify-smtp')) {
	await verifySmtpCredentials();
} else if (process.argv.includes('--configure-local')) {
	await configureLocalEnvironment();
} else {
	console.log(JSON.stringify(webpush.generateVAPIDKeys(), null, 2));
}