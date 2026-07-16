// ============================================================
// WIOS web push helper. Zero npm dependencies (node crypto only).
// Implements RFC 8291 (aes128gcm) payload encryption + VAPID (RFC 8292).
// ============================================================
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
};

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function vapidJwt(audience, subject, publicKeyB64u, privateKeyB64u) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const payload = b64u(JSON.stringify({ aud: audience, exp, sub: subject }));
  const unsigned = header + '.' + payload;
  const pub = fromB64u(publicKeyB64u); // 65 bytes: 0x04 || x || y
  const jwk = {
    kty: 'EC', crv: 'P-256',
    d: privateKeyB64u,
    x: b64u(pub.subarray(1, 33)),
    y: b64u(pub.subarray(33, 65)),
  };
  const key = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return unsigned + '.' + b64u(sig);
}

// RFC 8291 encryption of the payload for one subscription
function encryptPayload(payloadStr, p256dhB64u, authB64u) {
  const clientPub = fromB64u(p256dhB64u);   // 65 bytes
  const authSecret = fromB64u(authB64u);    // 16 bytes
  const ecdh = crypto.createECDH('prime256v1');
  const serverPub = ecdh.generateKeys();
  const shared = ecdh.computeSecret(clientPub);
  const salt = crypto.randomBytes(16);

  // HKDF chain per RFC 8291 section 3.4
  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), clientPub, serverPub]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plaintext = Buffer.concat([Buffer.from(payloadStr, 'utf8'), Buffer.from([2])]); // 0x02 = last record delimiter
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  // aes128gcm header: salt(16) | record size(4) | idlen(1) | keyid(server public key, 65)
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  const headerBuf = Buffer.concat([salt, rs, Buffer.from([serverPub.length]), serverPub]);
  return Buffer.concat([headerBuf, ct]);
}

// Send one push. Returns { ok, status, gone } (gone = subscription expired, delete it).
async function sendPush(sub, payloadObj, env) {
  const endpoint = sub.endpoint;
  const url = new URL(endpoint);
  const audience = url.origin;
  const jwt = vapidJwt(audience, 'mailto:hq@uglydonutsncorndogs.com', env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  const body = encryptPayload(JSON.stringify(payloadObj), sub.p256dh, sub.auth);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'TTL': '86400',
      'Urgency': 'normal',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
    },
    body,
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

// Supabase REST helper (service key)
function makeSb(env) {
  const SUPA_URL = 'https://xttqxjuunuchlxjrknyt.supabase.co';
  return async function sb(path, opts = {}) {
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Supabase ${path}: ${res.status} ${t}`);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  };
}

// Push to a list of user ids; cleans up expired subscriptions.
async function pushToUsers(userIds, payloadObj, env) {
  if (!userIds || !userIds.length) return 0;
  const sb = makeSb(env);
  const ids = userIds.map((x) => `"${x}"`).join(',');
  const subs = await sb(`wios_push_subs?user_id=in.(${ids})&select=*`);
  let sent = 0;
  for (const s of subs) {
    try {
      const r = await sendPush(s, payloadObj, env);
      if (r.ok) sent++;
      else if (r.gone) {
        await sb(`wios_push_subs?id=eq.${s.id}`, { method: 'DELETE' });
      }
    } catch (e) {
      console.error('push error', e.message);
    }
  }
  return sent;
}

module.exports = { sendPush, pushToUsers, makeSb };
