import { createHmac, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes) {
  let bits = 0, value = 0, output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; output += alphabet[(value >>> bits) & 31]; }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
function decode(secret) {
  let bits = 0, value = 0; const bytes = [];
  for (const char of secret) {
    const n = alphabet.indexOf(char);
    if (n < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | n; bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}
export const newSecret = () => base32(randomBytes(20));
// RFC 6238: SHA-1, 30-second step, 6 digits for authenticator compatibility.
export function totp(secret, time = Date.now(), digits = 6) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const mac = createHmac('sha1', decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return ((mac.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).toString().padStart(digits, '0');
}
export function verifyTotp(secret, code, lastStep = -1, time = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(time / 30000);
  for (const candidate of [step, step - 1, step + 1]) {
    if (candidate > lastStep && timingSafeEqual(Buffer.from(totp(secret, candidate * 30000)), Buffer.from(code))) return candidate;
  }
  return null;
}
export function seal(secret, key, userId) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function unseal(value, key, userId) {
  const packed = Buffer.from(value, 'base64'), cipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  cipher.setAAD(Buffer.from(userId)); cipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([cipher.update(packed.subarray(28)), cipher.final()]).toString('utf8');
}
