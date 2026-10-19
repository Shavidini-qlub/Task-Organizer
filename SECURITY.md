# Security notes

Built against [clubpay/ai-builder-skills](https://github.com/clubpay/ai-builder-skills) and the Qlub Internal Tool Guardrail.

## Data

- **Stored:** task text, notes, board names, review notes, and the employee's Google name and work email.
- **Not stored:** customer data, transactions, payment info, or any production data. Users are told not to enter any.
- **Sent to Slack, only for people who switch reminders on:** a summary of their open tasks (counts, plus up to 5 task titles and their board names) to their own DM, or to a channel they chose and belong to.
- **Sent to Anthropic (Claude), only when a user clicks a Claude button:** the text, priority and dates of that user's open tasks on the current board ("Plan my day"), or the notes they paste ("Notes → tasks"). No names, emails or IDs are sent. This must use Qlub's company Anthropic account, which the component register lists as approved with conditions.

## Controls in place

| Area | Control |
|---|---|
| Authentication | Google Workspace SSO (approved component) using Google's official library with state, nonce and PKCE. Restricted to `@qlub.io`, checked server-side (`hd` claim + verified email). No passwords. |
| Sessions | Server-side sessions (Postgres in production). Cookie is `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Lax`, expires after 12h idle. Session ID rotates on login, and logout destroys the session server-side. |
| Authorization | Every query is scoped to the signed-in user's ID. Moving or filing items requires owning the target board. Covered by `test/api.test.js`. |
| CSRF | `SameSite=Lax`, plus every non-GET request must carry `X-Requested-With: fetch` and a matching `Origin`. |
| Input validation | zod schemas on every write, with length limits and enums. SQL is fully parameterised, and dynamic `SET` clauses use whitelisted column names. |
| XSS | User text is rendered with `textContent`. CSP is `script-src 'self'` with no inline scripts and `frame-ancestors 'none'`. |
| Rate limits | 30 requests / 15 min per IP on `/auth`, 600 / min on `/api`. Per-user caps: 50 boards, 5000 tasks. 32 KB body limit. |
| Secrets | Read only from environment variables. `.env` is gitignored, and only `.env.example` is committed. |
| Production safety | Startup fails if a required setting is missing or `DEV_LOGIN` is on. Errors return no stack traces. |
| AI (Claude) | API key is server-side only. Sign-in required, 6 requests/min per user, a daily cap per user stored in the database (`AI_DAILY_LIMIT`, default 30), notes capped at 6,000 characters, output tokens capped. Claude can't take actions: "Plan" only highlights the user's own tasks (task numbers are mapped back server-side; unknown ones are dropped), and "Notes → tasks" returns drafts the user must tick before they're added through the normal validated API. Structured output is re-validated on the server and rendered with `textContent`. Pasted notes are fenced in `<notes>` tags and treated as data. Refusals are handled, with `fallbacks: "default"` on. Covered by `test/ai.test.js`. |
| Slack reminders | One company-owned Slack bot. Its token is server-side only, and calls go only to `slack.com`. People are matched to Slack by their verified @qlub.io email. Channel delivery is allowed only to channels the person is a member of (checked when saving and again before every send), with an on-screen warning that the channel will see their tasks. DM is the default. Task text is escaped so it can't create mentions or links. Each reminder is sent at most once per day (claimed in the database first). "Send a test" is limited to 3 per 10 minutes. Covered by `test/reminders.test.js`. |
| Logging | Structured JSON to stdout with request IDs. Logs user IDs, never emails, tokens or bodies. Records login success/failure, logout, CSRF blocks and rate-limit trips. |

## Reviewed scanner findings

- `scan_repository.py`: "Unsafe HTML rendering sink" in `public/app.js`. **Reviewed, false positive.** Every `innerHTML` assignment renders fixed SVG icons, fixed labels or app-generated dates. No user- or server-supplied text reaches it.
- `scan_repository.py`: "Sensitive configuration file tracked" for `.env.example`. **Reviewed, false positive.** It's the committed template: every secret field (`SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `DATABASE_URL`) is empty. The real `.env` is gitignored and has never been committed.

## Open items before release

1. Move the repository to the Qlub-managed GitHub org (`qlubapps`). A personal GitHub account is NOT APPROVED in the component register.
2. Confirm Railway (Qlub workspace) as the hosting platform with DevOps. It's listed as "request review".
3. Create the Google OAuth client in a Qlub-owned Google Cloud project.
4. Create the Slack app from `slack-app-manifest.yml` in Qlub's Slack workspace (owned by a Qlub admin) and set `SLACK_BOT_TOKEN`. Ask #devops-support.
5. Get an `ANTHROPIC_API_KEY` from Qlub's company Anthropic workspace (never a personal key), and set a billing alert on it.
6. Send logs to the company log stack and add one alert (e.g. a spike in `login_failed` or `rate_limited`). Ask #devops-support.
7. The rate limiter keeps its counts in memory. Fine for one instance; use a shared store before scaling out.
8. Tell #devops-support what was deployed and where.
