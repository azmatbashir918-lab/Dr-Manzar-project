import { resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
export function loadConfig() {
  const production = process.env.NODE_ENV === 'production';
  const privateTesting = process.env.DEPLOYMENT_MODE === 'private-testing';
  // MFA is implemented; the rest of the production release review is still outstanding.
  if (production && !privateTesting) throw new Error('Production release blocked: operational controls and deployment security review remain outstanding.');
  if (privateTesting && !production) throw new Error('Private testing requires NODE_ENV=production for secure cookies.');
  const mongoUri = process.env.MONGODB_URI || '', mongoDb = process.env.MONGODB_DB || 'dr_manzar';
  if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) throw new Error('Set MONGODB_URI in backend/.env. MongoDB is required.');
  if (/[<>\s]/.test(mongoUri)) throw new Error('MONGODB_URI contains placeholders or whitespace.');
  const origin = process.env.APP_ORIGIN || (privateTesting ? process.env.RENDER_EXTERNAL_URL : '') || 'http://localhost:5173';
  if (new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must be an exact origin without a trailing slash');
  if (privateTesting) {
    if (!origin.startsWith('https://')) throw new Error('Private testing requires an HTTPS APP_ORIGIN.');
    if (!process.env.MFA_ENCRYPTION_KEY) throw new Error('Private testing requires a persistent MFA_ENCRYPTION_KEY.');
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(process.env.TEST_ACCESS_USER || '') || (process.env.TEST_ACCESS_PASSWORD || '').length < 20) throw new Error('Private testing requires TEST_ACCESS_USER and a TEST_ACCESS_PASSWORD of at least 20 characters.');
    if (process.env.MAIL_MODE !== 'resend' || !process.env.RESEND_API_KEY || !process.env.MAIL_FROM) throw new Error('Private testing requires Resend HTTPS email configuration.');
    if (process.env.MEDIA_STORAGE !== 'mongodb') throw new Error('Private testing requires durable MongoDB media storage.');
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (stripeKey && !stripeKey.startsWith('sk_test_')) throw new Error('Only Stripe test keys are accepted in this development release');
  let mfaKey;
  if (process.env.MFA_ENCRYPTION_KEY) {
    if (!/^[a-fA-F0-9]{64}$/.test(process.env.MFA_ENCRYPTION_KEY)) throw new Error('MFA_ENCRYPTION_KEY must be 64 hexadecimal characters');
    mfaKey = Buffer.from(process.env.MFA_ENCRYPTION_KEY, 'hex');
  } else {
    // Local-only persistent key. Never expose it through an API or console output.
    mkdirSync(resolve('data'), { recursive: true });
    const path = resolve('data/mfa.key');
    try { writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    mfaKey = readFileSync(path);
    if (mfaKey.length !== 32) throw new Error('Local MFA encryption key is invalid');
  }
  return {
    production, privateTesting, origin, mfaKey, mongoUri, mongoDb,
    mediaStorageMode: process.env.MEDIA_STORAGE || 'local',
    resendApiKey: process.env.RESEND_API_KEY || '', mailFrom: process.env.MAIL_FROM || '',
    testAccessUser: process.env.TEST_ACCESS_USER || '', testAccessPassword: process.env.TEST_ACCESS_PASSWORD || '',
    frontendDirectory: process.env.FRONTEND_DIRECTORY ? resolve(process.env.FRONTEND_DIRECTORY) : undefined,
    mailMode: process.env.MAIL_MODE || 'file', mailDirectory: resolve('data/mail'),
    coverDirectory: resolve(process.env.COVER_DIRECTORY || 'data/covers'),
    audioDirectory: resolve(process.env.AUDIO_DIRECTORY || 'data/narration'),
    audioWorkDirectory: resolve(process.env.AUDIO_WORK_DIRECTORY || 'data/narration-work'),
    ffmpegPath: process.env.FFMPEG_PATH || undefined,
    privateBookDirectory: resolve(process.env.PRIVATE_BOOK_DIRECTORY || 'data/private-books'),
    stripeKey, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  };
}
