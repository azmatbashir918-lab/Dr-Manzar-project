import { randomBytes, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function checkPassword(password, encoded) {
  const [salt, expected] = encoded.split(':');
  const actual = await scrypt(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role,
    verified: Boolean(user.verified), suspended: Boolean(user.suspended), language: user.language,
    profile: typeof user.profile === 'string' ? JSON.parse(user.profile) : user.profile || {}, marketingConsent: Boolean(user.marketing), createdAt: user.created_at };
}
