import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { hashPassword } from './security.js';
import { signup } from './schemas.js';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
const config = loadConfig();
let name = process.env.ADMIN_NAME, email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
if (!name || !email || !password) {
  if (!process.stdin.isTTY) throw new Error('Run create-admin in an interactive terminal or supply ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD.');
  let muted = false;
  const output = new Writable({ write(chunk, encoding, next) { if (!muted) process.stdout.write(chunk); next(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    name ||= await rl.question('Your name: ');
    email ||= await rl.question('Your email: ');
    if (!password) {
      process.stdout.write('Password (minimum 12 characters, hidden): '); muted = true;
      password = await rl.question(''); process.stdout.write('\n');
      process.stdout.write('Confirm password (hidden): ');
      const confirm = await rl.question(''); process.stdout.write('\n'); muted = false;
      if (password !== confirm) throw new Error('Passwords do not match. Run setup again.');
    }
  } finally { muted = false; rl.close(); }
}
const data = signup.parse({ name, email, password, acceptTerms: true });
let db;
try { db = await openDatabase({uri:config.mongoUri,name:config.mongoDb}); }
catch { console.error('MongoDB connection failed. Check backend/.env and Atlas access. No account was created.'); process.exit(1); }
try {
  await db.insert('users',{id:randomUUID(),email:data.email,name:data.name,password_hash:await hashPassword(data.password),role:'owner',verified:1,suspended:0,language:'ur',profile:{},marketing:0,consent_at:null,terms_version:'1.1',created_at:Date.now()});
  console.log('Owner account created. Clear ADMIN_PASSWORD from your environment.');
} catch(error) { console.error(error.code===11000?'An account with that email already exists; no promotion or overwrite was performed.':'Admin creation failed; check MongoDB access.');process.exitCode=1; }
finally { await db.close(); }
