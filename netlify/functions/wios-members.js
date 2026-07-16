// ============================================================
// WIOS member management. Admin only.
//
// POST { action: 'add', email, name, role, isAdmin }
//   - If the email already has an account (every C-level already has one
//     from uglyops, since it is the same Supabase project), it is linked.
//     No new password, no email: they sign in with what they already use.
//   - If not, a new account is created and a temporary password is emailed.
//
// POST { action: 'update', userId, name, role, isAdmin }
// POST { action: 'setActive', userId, active }
//   Deactivating never deletes the auth user, because uglyops shares it.
//   Their WIOS history stays intact and can be turned back on.
// ============================================================
const SUPA_URL = 'https://xttqxjuunuchlxjrknyt.supabase.co';
const ANON_KEY = 'sb_publishable_qL2xlkjIkIWGOkzaDitIJw_3iRNx9dA';

function svc(env) {
  return {
    'apikey': env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function rest(env, path, opts = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { ...svc(env), 'Prefer': 'return=representation', ...(opts.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : [];
}

exports.handler = async (event) => {
  const env = process.env;
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    // ── caller must be an active WIOS admin ──
    const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sign in again.' }) };

    const uRes = await fetch(`${SUPA_URL}/auth/v1/user`, {
      headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${token}` },
    });
    if (!uRes.ok) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Sign in again.' }) };
    const caller = await uRes.json();

    const me = await rest(env, `wios_profiles?id=eq.${caller.id}&select=id,is_admin,active`);
    if (!me.length || !me[0].is_admin || !me[0].active) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Only an admin can manage members.' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const action = body.action;

    // ── update an existing member ──
    if (action === 'update') {
      const patch = {};
      if (body.name) patch.name = String(body.name).trim();
      if (body.role) patch.role = String(body.role).trim().toUpperCase();
      if (typeof body.isAdmin === 'boolean') patch.is_admin = body.isAdmin;
      if (!Object.keys(patch).length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Nothing to update.' }) };
      if (patch.is_admin === false && body.userId === caller.id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'You cannot remove your own admin access.' }) };
      }
      await rest(env, `wios_profiles?id=eq.${body.userId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── activate / deactivate ──
    if (action === 'setActive') {
      if (body.userId === caller.id && body.active === false) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'You cannot deactivate yourself.' }) };
      }
      await rest(env, `wios_profiles?id=eq.${body.userId}`, {
        method: 'PATCH', body: JSON.stringify({ active: !!body.active }),
      });
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── add a member ──
    if (action !== 'add') return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action.' }) };

    const email = String(body.email || '').trim().toLowerCase();
    const name = String(body.name || '').trim();
    const role = String(body.role || '').trim().toUpperCase();
    const isAdmin = !!body.isAdmin;
    if (!email || !name || !role) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email, name and role are all required.' }) };
    }

    // Does this email already have an account? (every uglyops user does)
    const found = await fetch(`${SUPA_URL}/rest/v1/rpc/wios_find_auth_user`, {
      method: 'POST', headers: svc(env), body: JSON.stringify({ p_email: email }),
    });
    if (!found.ok) throw new Error('Lookup failed: ' + (await found.text()));
    let userId = await found.json();   // uuid or null

    let created = false;
    let tempPass = null;

    if (!userId) {
      // No account yet: create one and email a temporary password.
      tempPass = Math.random().toString(36).slice(-8) + 'Aa1!';
      const cRes = await fetch(`${SUPA_URL}/auth/v1/admin/users`, {
        method: 'POST', headers: svc(env),
        body: JSON.stringify({ email, password: tempPass, email_confirm: true, user_metadata: { name } }),
      });
      const cData = await cRes.json();
      if (!cRes.ok) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: cData.message || cData.msg || 'Could not create the account.' }) };
      }
      userId = cData.id;
      created = true;
    }

    // Link (or re-link) the WIOS profile.
    await rest(env, 'wios_profiles', {
      method: 'POST',
      headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ id: userId, name, role, is_admin: isAdmin, active: true }),
    });

    // Email the temporary password only when a brand new account was created.
    let emailSent = false;
    let emailError = null;
    if (created) {
      if (env.RESEND_API_KEY) {
        const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0E0E0E;color:#F0EDE8;padding:32px;border-radius:12px;">
<div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#CC9C3A;margin-bottom:8px;">Ugly Donuts &amp; Corn Dogs</div>
<h1 style="font-size:24px;margin:0 0 8px;letter-spacing:.04em;">Welcome to WIOS</h1>
<p style="color:#8A8480;font-size:14px;margin:0 0 24px;">Your leadership workspace account is ready, <strong style="color:#F0EDE8;">${name}</strong>.</p>
<div style="background:#1E1E1E;border:1px solid #2E2E2E;border-radius:10px;padding:20px;margin-bottom:20px;">
<div style="margin-bottom:14px;"><div style="font-size:11px;color:#8A8480;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Sign in at</div><div style="font-size:15px;font-weight:700;color:#CC9C3A;">https://wios.netlify.app</div></div>
<div style="margin-bottom:14px;"><div style="font-size:11px;color:#8A8480;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Email</div><div style="font-size:15px;font-weight:700;">${email}</div></div>
<div><div style="font-size:11px;color:#8A8480;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px;">Temporary password</div><div style="font-size:22px;font-weight:700;font-family:monospace;letter-spacing:.1em;color:#CC9C3A;">${tempPass}</div></div>
</div>
<div style="background:rgba(204,156,58,.08);border:1px solid rgba(204,156,58,.3);border-radius:8px;padding:12px;margin-bottom:20px;">
<p style="color:#CC9C3A;font-size:13px;margin:0;">Change this password after you sign in: Settings, then Change password.</p></div>
<p style="color:#8A8480;font-size:13px;line-height:1.6;margin:0 0 20px;">On your phone, open the link in your browser and add WIOS to your Home Screen. That is what turns on notifications.</p>
<p style="color:#5A5654;font-size:11px;margin-top:24px;">Ugly Donuts &amp; Corn Dogs Franchising LLC</p></div>`;
        const eRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Ugly Donuts & Corn Dogs HQ <do-not-reply@uglydonuts-franchiseportal.com>',
            to: [email], subject: 'Your WIOS account', html,
          }),
        });
        emailSent = eRes.ok;
        if (!eRes.ok) emailError = await eRes.text();
      } else {
        emailError = 'RESEND_API_KEY is not set in the Netlify environment variables.';
      }
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({ ok: true, userId, created, linked: !created, emailSent, emailError, tempPass }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
