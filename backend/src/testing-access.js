import { createHash, timingSafeEqual } from 'node:crypto';
const fingerprint = value => createHash('sha256').update(value).digest();

// Temporary outer gate. Application accounts, roles and MFA are still required.
export function testingAccess(config) {
  const expected = fingerprint(`${config.testAccessUser}:${config.testAccessPassword}`);
  return (req, res, next) => {
    // Stripe cannot provide browser credentials. Its endpoint verifies signatures.
    if (req.method === 'POST' && req.path === '/api/v1/payments/webhook') return next();
    res.set({'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});
    const value = req.get('authorization') || '';
    const supplied = /^Basic [A-Za-z0-9+/=]+$/.test(value)
      ? Buffer.from(value.slice(6), 'base64').toString('utf8') : '';
    if (!timingSafeEqual(expected, fingerprint(supplied))) {
      res.set('WWW-Authenticate', 'Basic realm="Dr Manzar private testing", charset="UTF-8"');
      return res.status(401).send('Private testing: access credentials required.');
    }
    next();
  };
}
