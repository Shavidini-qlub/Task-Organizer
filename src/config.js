// All runtime configuration comes from environment variables (see
// .env.example). In production every required value is checked at startup
// so a misconfigured deploy fails loudly instead of running half-secured.
import crypto from "node:crypto";

function bool(v) {
  return v === "true" || v === "1";
}

export function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === "production";
  const port = Number(env.PORT) || 3000;
  const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");

  const cfg = {
    isProd,
    port,
    publicUrl,
    publicOrigin: new URL(publicUrl).origin,
    databaseUrl: env.DATABASE_URL || null,
    pgliteDir: env.PGLITE_DIR || ".pglite",
    sessionSecret: env.SESSION_SECRET || null,
    sessionMaxAgeHours: Number(env.SESSION_MAX_AGE_HOURS) || 12,
    googleClientId: env.GOOGLE_CLIENT_ID || null,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || null,
    allowedDomain: (env.ALLOWED_EMAIL_DOMAIN || "qlub.io").toLowerCase(),
    devLogin: bool(env.DEV_LOGIN),
  };
  cfg.googleEnabled = !!(cfg.googleClientId && cfg.googleClientSecret);

  if (isProd) {
    const problems = [];
    if (!cfg.databaseUrl) problems.push("DATABASE_URL is required");
    if (!cfg.sessionSecret || cfg.sessionSecret.length < 32) problems.push("SESSION_SECRET must be at least 32 characters");
    if (!cfg.googleEnabled) problems.push("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required");
    if (!publicUrl.startsWith("https://")) problems.push("PUBLIC_URL must be an https:// URL");
    if (cfg.devLogin) problems.push("DEV_LOGIN must not be enabled in production");
    if (problems.length) throw new Error("Invalid production config: " + problems.join("; "));
  } else if (!cfg.sessionSecret) {
    // Local dev only: a fresh secret per boot just means signing in again
    // after a restart.
    cfg.sessionSecret = crypto.randomBytes(32).toString("hex");
  }
  return cfg;
}
