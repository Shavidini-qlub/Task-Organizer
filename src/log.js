// Structured JSON logs to stdout (Railway collects them). Log user IDs, never
// emails, tokens, session IDs or request bodies.
export function log(level, event, fields = {}) {
  const line = { ts: new Date().toISOString(), level, event, ...fields };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(JSON.stringify(line));
}
