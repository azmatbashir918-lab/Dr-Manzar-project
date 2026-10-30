import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../../src/config.js';

test('private Render config requires HTTPS, durable media, stable MFA key and HTTPS email',()=>{
  const previous=process.env;
  try {
    const valid={NODE_ENV:'production',DEPLOYMENT_MODE:'private-testing',MONGODB_URI:'mongodb://localhost:27017',MONGODB_DB:'test',RENDER_EXTERNAL_URL:'https://testing.onrender.com',MFA_ENCRYPTION_KEY:'a'.repeat(64),MEDIA_STORAGE:'mongodb',TEST_ACCESS_USER:'reviewer',TEST_ACCESS_PASSWORD:'a'.repeat(24),MAIL_MODE:'resend',RESEND_API_KEY:'fixture',MAIL_FROM:'author@example.com'};
    process.env={...valid};const config=loadConfig();assert.equal(config.origin,valid.RENDER_EXTERNAL_URL);assert.equal(config.production,true);assert.equal(config.privateTesting,true);
    for(const [key,value] of Object.entries({NODE_ENV:'development',APP_ORIGIN:'http://testing.onrender.com',MFA_ENCRYPTION_KEY:'',TEST_ACCESS_PASSWORD:'short',MEDIA_STORAGE:'local',MAIL_MODE:'file',RESEND_API_KEY:'',MAIL_FROM:''})) {
      process.env={...valid,[key]:value};assert.throws(()=>loadConfig(),undefined,`unsafe ${key} rejected`);
    }
    process.env={...valid,DEPLOYMENT_MODE:''};assert.throws(()=>loadConfig(),/Production release blocked/);
    process.env={...valid,STRIPE_SECRET_KEY:'sk_live_forbidden'};assert.throws(()=>loadConfig(),/Only Stripe test keys/);
  } finally { process.env=previous; }
});
