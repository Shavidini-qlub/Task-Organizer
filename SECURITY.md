# Security notes

Built against [clubpay/ai-builder-skills](https://github.com/clubpay/ai-builder-skills) and the Qlub Internal Tool Guardrail.

## Data

- **Stored:** task text, notes, board names, review notes, and the employee's Google name and work email.
- **Not stored:** customer data, transactions, payment info, or any production data. Users are told not to enter any.

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
| Logging | Structured JSON to stdout with request IDs. Logs user IDs, never emails, tokens or bodies. Records login success/failure, logout, CSRF blocks and rate-limit trips. |

## Reviewed scanner findings

- `scan_repository.py`: "Unsafe HTML rendering sink" in `public/app.js`. **Reviewed, false positive.** Every `innerHTML` assignment renders fixed SVG icons, fixed labels or app-generated dates. No user- or server-supplied text reaches it.

## Open items before release

1. Move the repository to the Qlub-managed GitHub org (`qlubapps`). A personal GitHub account is NOT APPROVED in the component register.
2. Confirm Railway (Qlub workspace) as the hosting platform with DevOps. It's listed as "request review".
3. Create the Google OAuth client in a Qlub-owned Google Cloud project.
4. Send logs to the company log stack and add one alert (e.g. a spike in `login_failed` or `rate_limited`). Ask #devops-support.
5. The rate limiter keeps its counts in memory. Fine for one instance; use a shared store before scaling out.
6. Tell #devops-support what was deployed and where.
