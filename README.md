# WIOS

Leadership workspace for Ugly Donuts & Corn Dogs. Mobile-only PWA.

Runs on its own Supabase project (xttqxjuunuchlxjrknyt), completely separate
from uglyops. All tables use the `wios_` prefix with their own RLS.

## Stack
- Single-file React + Babel 7 CDN, no build step: index.html
- Supabase
- Netlify (functions + a 30-minute cron)
- Zero-dependency web push (RFC 8291 + VAPID)

## Login
Members sign in with an ID, the part before the @ (john.kim, sonya.lee, ...).
The app adds @uglydonutsncorndogs.com behind the scenes. A full email still
works too.

## Setup, once
1. In the Supabase SQL editor, run wios_schema.sql top to bottom. It builds
   every table, all the RLS, AND creates the 5 founder accounts with the
   shared password Djrmffl202!. Nothing to fill in. The file is idempotent,
   so re-running is safe.
   After it runs, delete the SQL file copy you kept, since it contains the
   starting password in plain text.
2. New GitHub repo, push this folder. New Netlify site (wios5.netlify.app).
3. Generate push keys:  node tools/gen-vapid.mjs
4. Netlify environment variables:
   - VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  (from step 3)
   - SUPABASE_SERVICE_KEY                 (this new project's service_role key)
   - RESEND_API_KEY                       (same value uglyops uses, for member invites)
   - ANTHROPIC_API_KEY                    (for the Ask tab)
5. Deploy, confirm "Published", install to the Home Screen, turn on
   notifications per device.

The 5 starting accounts:
  john.kim (admin), sonya.lee, deborah.lee, jiwoon.lee, joseph.lee
Everyone should change their password after first sign-in: Settings, then
Change password.

## Adding people later
Settings, then Members, then Add a member. Admin only. Enter the ID (part
before the @). If that account already exists it is linked; otherwise a new
account is created and a temporary password is emailed. Roles are free text
(CEO, CFO, whatever). Turning someone off keeps all their history.

## Ask tab
Ask questions in plain language about the work recorded in WIOS: tasks, goals,
daily reminders, and coop tasks. It reads only what you are allowed to see.
Admins can ask about the whole team, everyone else only their own records. It
reads, it does not create or change anything. Runs on Claude Sonnet 5 and needs
the ANTHROPIC_API_KEY environment variable.

## Files
- index.html ................ the whole app
- sw.js .................... service worker: push, click, badge
- manifest.webmanifest ..... PWA manifest
- netlify.toml ............. publish, functions, cron schedule
- netlify/functions/
  - notify.js ............. GET the VAPID key, POST a push
  - wios-members.js ....... add, edit and deactivate members (admin only)
  - ask.js ................ answers questions about your WIOS data (Claude Sonnet)
  - cron.js ............... every 30 minutes
  - lib-push.js ........... push crypto + Supabase REST helper
- tools/gen-vapid.mjs ...... one-time VAPID key generator
- icons/ .................. app icons
- wios_schema.sql ......... schema, RLS, and the 5 founder accounts

The cron runs every 30 minutes: waiting reminders, tasks set aside for later,
daily reminders, and new goal-period prompts all land within 30 minutes.

VAPID keys and the Babel 7 pin must never change once people have subscribed.
