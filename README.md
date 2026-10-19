# Task Organizer

A to-do list that never drops a task.

## Problem

Unfinished tasks get lost from one day to the next. Today we rebuild the to-do list by hand from manual notes, which takes extra minutes each day and sometimes means missed follow-ups and deadlines.

## Solution

A task organizer that **automatically carries undone tasks forward into today's list**. A task stays open until you check it off. Nothing is removed on its own. Each Qlub employee signs in with Google and their tasks sync across devices.

### Features

- **Automatic rollover**: open tasks from earlier days show on Today with a "since <date> · Nd" badge
- **Boards**: separate lists (e.g. Official / Personal) with rename, delete, and bulk move between boards
- **Priorities**: High / Medium / Low, sorted automatically, or drag to reorder by hand
- **Notes**: a comment on each task
- **History**: see what was on the list on any past day
- **Completed**: every finished task in one place
- **Weekly & monthly review**: stats, a calendar view, review notes, and a "mark reviewed" flag
- **Midnight-aware**: a tab left open rolls over to the new day on its own
- Light and dark themes, works on mobile

## Architecture

```
browser ──► Express (src/server.js)
              ├─ /auth/*   Google Workspace sign-in, @qlub.io only (src/auth.js)
              ├─ /api/*    boards / tasks / reviews JSON API, per-user (src/api.js)
              └─ /         the app (views/index.html + public/*)
                    │
                    ▼
                 Postgres (Railway) ─ or PGlite locally (src/db.js)
```

- `public/app.js` is the UI. `public/api-store.js` connects it to the API.
- Sessions are server-side, in httpOnly cookies. Production stores them in Postgres.

## Run locally

Requires Node 22+.

```bash
npm install
cp .env.example .env     # DEV_LOGIN=true, no database needed
npm run dev              # http://localhost:3000
npm test
```

With no `DATABASE_URL`, the app uses an embedded Postgres (PGlite) stored in `./.pglite`. Local sessions live in memory, so you'll need to sign in again whenever the dev server restarts.

## Deploy (Railway, Qlub workspace)

1. Add a Postgres service. Railway provides `DATABASE_URL`.
2. Set these variables: `NODE_ENV=production`, `PUBLIC_URL=https://<app>.qlubapps.com`, `SESSION_SECRET` (`openssl rand -hex 32`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAIN=qlub.io`.
3. Create the Google OAuth client under a Qlub-owned Google Cloud project, with the redirect URI `https://<app>.qlubapps.com/auth/google/callback`.
4. Start command `npm start`. Health check `/healthz`.

The server refuses to start in production if any of these are missing, or if `DEV_LOGIN` is on.

## Scope & guardrails

Internal Qlub tool only. It must not store customer data, transaction info, PII, or payment details. See [SECURITY.md](SECURITY.md) for the controls in place and the steps still open before release.

## Credits

Idea: Vinay Peter (Operations). Built for the Qlub hackathon.
