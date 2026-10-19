import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { loadConfig } from "./config.js";
import { createDb } from "./db.js";
import { authRouter, requireAuth } from "./auth.js";
import { apiRouter } from "./api.js";
import { log } from "./log.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function createApp(cfg, db) {
  cfg.cookieName = cfg.isProd ? "__Host-sid" : "sid";
  const app = express();
  app.disable("x-powered-by");
  if (cfg.isProd) app.set("trust proxy", 1); // Railway terminates TLS in front of us

  // Request ID + one structured access-log line per request (path only, no
  // query string, no bodies).
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader("X-Request-Id", req.id);
    const start = Date.now();
    res.on("finish", () => {
      log(res.statusCode >= 500 ? "error" : "info", "http", {
        reqId: req.id, method: req.method, path: req.originalUrl.split("?")[0], status: res.statusCode,
        ms: Date.now() - start, userId: req.session?.userId,
      });
    });
    next();
  });

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
        "upgrade-insecure-requests": cfg.isProd ? [] : null,
      },
    },
    strictTransportSecurity: cfg.isProd,
  }));

  app.get("/healthz", (req, res) => res.type("text").send("ok"));

  const store = cfg.databaseUrl
    ? new (connectPgSimple(session))({ pool: db.pool, createTableIfMissing: true })
    : undefined; // local dev: in-memory sessions
  app.use(session({
    name: cfg.cookieName,
    secret: cfg.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, secure: cfg.isProd, sameSite: "lax", path: "/", maxAge: cfg.sessionMaxAgeHours * 3600 * 1000 },
  }));

  // CSRF: on top of SameSite=Lax, every state-changing request must come
  // from our own page (custom header + matching Origin when sent).
  app.use((req, res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const origin = req.get("origin");
    if (req.get("x-requested-with") !== "fetch" || (origin && origin !== cfg.publicOrigin)) {
      log("warn", "csrf_block", { reqId: req.id, path: req.path });
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  });

  app.use(express.json({ limit: "32kb" }));

  app.use("/auth", authRouter(cfg, db));
  app.use("/api", rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (req, res) => {
      log("warn", "rate_limited", { reqId: req.id, scope: "api", userId: req.session?.userId });
      res.status(429).json({ error: "rate_limited" });
    },
  }));
  app.use("/api", (req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  app.use("/api", requireAuth, apiRouter(db));

  const page = (name) => path.join(ROOT, "views", name);
  app.get("/", (req, res) => {
    if (!req.session.userId) return res.redirect("/login");
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(page("index.html"));
  });
  app.get("/login", (req, res) => {
    if (req.session.userId) return res.redirect("/");
    res.sendFile(page("login.html"));
  });
  app.use(express.static(path.join(ROOT, "public"), { index: false, maxAge: cfg.isProd ? "1h" : 0 }));

  app.use((req, res) => res.status(404).type("text").send("Not found"));
  // Never send stack traces or internals to the browser.
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) log("error", "unhandled_error", { reqId: req.id, message: err.message });
    if (res.headersSent) return next(err);
    res.status(status).json({ error: status >= 500 ? "server_error" : err.code || "bad_request" });
  });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cfg = loadConfig();
  const db = await createDb(cfg);
  const app = await createApp(cfg, db);
  app.listen(cfg.port, () => {
    log("info", "server_started", { port: cfg.port, prod: cfg.isProd, db: cfg.databaseUrl ? "postgres" : "pglite", google: cfg.googleEnabled, devLogin: !cfg.isProd && cfg.devLogin });
  });
}
