// Generate a VAPID key pair for WIOS push notifications.
// Run once:  node tools/gen-vapid.mjs
// Put the two values into Netlify env vars. NEVER regenerate after users subscribe.
import crypto from 'crypto';

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();

console.log('VAPID_PUBLIC_KEY=' + b64u(ecdh.getPublicKey()));
console.log('VAPID_PRIVATE_KEY=' + b64u(ecdh.getPrivateKey()));
