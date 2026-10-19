// Sign-in with Google Workspace (Qlub-approved SSO), restricted to one email
// domain and enforced server-side. Uses Google's official client library
// with state, nonce and PKCE; no passwords are ever handled here.
import crypto from "node:crypto";
import express from "express";
import { OAuth2Client } from "google-auth-library";
import rateLimit from "express-rate-limit";
import { log } from "./log.js";

const DEV_USER = { sub: "dev-local-user", name: "Dev User" };

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

async function upsertUser(db, { sub, email, name }) {
  const rows = await db.query(
    `INSERT INTO users (id, google_sub, email, name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_sub) DO UPDATE
       SET email = EXCLUDED.email, name = EXCLUDED.name, last_login_at = now()
     RETURNING id`,
    [crypto.randomUUID(), sub, email, name || ""]
  );
  return rows[0].id;
}

// Rotates the session ID on login so a pre-login session can't be fixated.
function startSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

export function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: "unauthenticated" });
}

export function authRouter(cfg, db) {
  const router = express.Router();
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) => {
      log("warn", "rate_limited", { reqId: req.id, scope: "auth", ip: req.ip });
      res.status(429).send("Too many requests");
    },
  });
  router.use(limiter);

  router.get("/options", (req, res) => {
    res.json({ google: cfg.googleEnabled, dev: !cfg.isProd && cfg.devLogin, domain: cfg.allowedDomain });
  });

  if (cfg.googleEnabled) {
    const redirectUri = cfg.publicUrl + "/auth/google/callback";
    const client = () => new OAuth2Client({ clientId: cfg.googleClientId, clientSecret: cfg.googleClientSecret, redirectUri });

    router.get("/google", async (req, res, next) => {
      try {
        const oauth = client();
        const { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
        const state = crypto.randomBytes(24).toString("base64url");
        const nonce = crypto.randomBytes(24).toString("base64url");
        req.session.oauth = { state, nonce, codeVerifier };
        const url = oauth.generateAuthUrl({
          scope: ["openid", "email", "profile"],
          state,
          nonce,
          code_challenge_method: "S256",
          code_challenge: codeChallenge,
          hd: cfg.allowedDomain,
          prompt: "select_account",
        });
        req.session.save(() => res.redirect(url));
      } catch (err) {
        next(err);
      }
    });

    router.get("/google/callback", async (req, res) => {
      const pending = req.session.oauth;
      delete req.session.oauth;
      const fail = (reason) => {
        log("warn", "login_failed", { reqId: req.id, reason });
        res.redirect("/login?error=" + encodeURIComponent(reason === "domain" ? "domain" : "failed"));
      };
      if (!pending || typeof req.query.code !== "string" || !safeEqual(req.query.state, pending.state)) {
        return fail("bad_state");
      }
      try {
        const oauth = client();
        const { tokens } = await oauth.getToken({ code: req.query.code, codeVerifier: pending.codeVerifier });
        const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: cfg.googleClientId });
        const p = ticket.getPayload() || {};
        if (!safeEqual(p.nonce, pending.nonce)) return fail("bad_nonce");
        const email = String(p.email || "").toLowerCase();
        if (!p.email_verified || p.hd !== cfg.allowedDomain || !email.endsWith("@" + cfg.allowedDomain)) {
          return fail("domain");
        }
        const userId = await upsertUser(db, { sub: p.sub, email, name: p.name });
        await startSession(req, userId);
        log("info", "login_success", { reqId: req.id, userId, method: "google" });
        res.redirect("/");
      } catch (err) {
        log("warn", "login_failed", { reqId: req.id, reason: "exchange_error", message: err.message });
        fail("exchange_error");
      }
    });
  }

  // Local development only. loadConfig() refuses to start production with
  // DEV_LOGIN enabled, and this route is never registered in production.
  if (!cfg.isProd && cfg.devLogin) {
    // Optional {"user": "alice"} picks a separate local test user.
    router.post("/dev-login", express.json({ limit: "1kb" }), async (req, res, next) => {
      try {
        const handle = typeof req.body?.user === "string" && /^[a-z0-9]{1,20}$/.test(req.body.user) ? req.body.user : null;
        const user = handle
          ? { sub: "dev-local-" + handle, name: "Dev " + handle, email: handle + "@" + cfg.allowedDomain }
          : { ...DEV_USER, email: "dev@" + cfg.allowedDomain };
        const userId = await upsertUser(db, user);
        await startSession(req, userId);
        log("info", "login_success", { reqId: req.id, userId, method: "dev" });
        res.status(204).end();
      } catch (err) {
        next(err);
      }
    });
  }

  router.post("/logout", (req, res) => {
    const userId = req.session && req.session.userId;
    req.session.destroy(() => {
      res.clearCookie(cfg.cookieName, { path: "/", httpOnly: true, secure: cfg.isProd, sameSite: "lax" });
      if (userId) log("info", "logout", { reqId: req.id, userId });
      res.status(204).end();
    });
  });

  return router;
}
