import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';

export function createMailer(config, request = fetch) {
  const transport = config.mailMode === 'smtp' ? nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
  }) : null;
  return async ({ to, subject, text }) => {
    if (config.mailMode === 'resend') {
      const response = await request('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: {Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type':'application/json'},
        body: JSON.stringify({from: config.mailFrom, to: [to], subject, text}),
      });
      if (!response.ok) throw new Error('Email provider rejected delivery. Check sender verification and quota.');
      return;
    }
    if (transport) return transport.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
    if (config.production) throw new Error('SMTP required in production');
    const dir = resolve(config.mailDirectory);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ to, subject, text }, null, 2), { mode: 0o600 });
  };
}
