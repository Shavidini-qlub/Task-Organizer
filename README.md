# Task Organizer

A to-do list that never drops a task.

## Problem

Unfinished tasks get lost from one day to the next. Today we rebuild the to-do list by hand from manual notes, which takes extra minutes each day and sometimes means missed follow-ups and deadlines.

## Solution

A task organizer that **automatically carries undone tasks forward into today's list**. A task stays open until you check it off. Nothing is removed on its own. Each Qlub employee signs in with Google and their tasks sync across devices.

### Features

- **Automatic rollover**: open tasks from earlier days show on Today with a "since <date> · Nd" badge
- **Boards**: separate lists (e.g. Official / Personal) with rename, delete, and bulk move between boards
- **Claude: Plan my day**: Claude reads your open, carried-over and overdue tasks and suggests what to tackle first, and why
- **Claude: Notes → tasks**: paste meeting notes, an email or a Slack thread. Claude drafts the follow-ups with priorities and due dates, and you tick which ones to add
- **Due dates**: optional per task. Shows "due today", "due tomorrow" or "overdue Nd". Overdue and due-today tasks move to the top, and a "due / overdue" counter keeps them visible
- **Daily Slack reminder**: each morning (your chosen time and timezone, weekdays or every day), a summary of what's overdue, due today and carried over, with the top tasks to start with. Sent as a private DM, or to a channel you're in
- **Snooze**: hide a task until tomorrow, Monday, next week or any date. It comes back on its own, and earlier if its due date arrives first, so snoozing never hides a deadline
- **Repeating tasks**: every day, every weekday, every week or every month. Completing one schedules the next copy (shown under "Snoozed & upcoming"), and undoing the completion removes it
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
              ├─ /api/ai/* Claude features: plan + notes→tasks (src/ai.js) ──► Anthropic API
              ├─ /api/reminders  daily Slack reminder settings (src/reminders.js) ──► Slack API
              │                  + a once-a-minute check that sends what's due
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

Claude features stay off until you set `ANTHROPIC_API_KEY` in `.env`. Everything else works without it. With no `DATABASE_URL`, the app uses an embedded Postgres (PGlite) stored in `./.pglite`. Local sessions live in memory, so you'll need to sign in again whenever the dev server restarts.

## Deploy (Railway, Qlub workspace)

1. Add a Postgres service. Railway provides `DATABASE_URL`.
2. Set these variables: `NODE_ENV=production`, `PUBLIC_URL=https://<app>.qlubapps.com`, `SESSION_SECRET` (`openssl rand -hex 32`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAIN=qlub.io`, and `ANTHROPIC_API_KEY` (from Qlub's company Anthropic account) to turn on the Claude features.
3. Create the Google OAuth client under a Qlub-owned Google Cloud project, with the redirect URI `https://<app>.qlubapps.com/auth/google/callback`.
4. Start command `npm start`. Health check `/healthz`.
5. Optional, for daily reminders: create the Slack app from [slack-app-manifest.yml](slack-app-manifest.yml) in Qlub's Slack workspace, install it, and set `SLACK_BOT_TOKEN`. People then invite the bot to a channel if they want reminders there instead of a DM.

The server refuses to start in production if any of these are missing, or if `DEV_LOGIN` is on.

## Scope & guardrails

Internal Qlub tool only. It must not store customer data, transaction info, PII, or payment details. See [SECURITY.md](SECURITY.md) for the controls in place and the steps still open before release.

## Credits

Idea: Vinay Peter (Operations). Built for the Qlub hackathon.
