// Daily Slack reminder of what's overdue, due today and carried over.
//
// Each person switches it on in the app, picks a time (in their own
// timezone) and where it goes: a private DM from the bot, or a channel they
// belong to. A once-a-minute check sends whatever is due; claiming the day
// in the database means each reminder goes out at most once per day, even
// across restarts or several server instances.
import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { slackEscape, SlackError } from "./slack.js";
import { daysBetween } from "./schedule.js";
import { log } from "./log.js";

const MAX_LISTED = 5;

function validTimezone(tz) {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const settingsBody = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().min(1).max(64).refine(validTimezone),
  weekdaysOnly: z.boolean(),
  destination: z.enum(["dm", "channel"]),
  channelId: z.string().regex(/^[CG][A-Z0-9]{2,30}$/).nullable(),
});

// The local calendar day, time and weekday for a timezone at `now`.
export function localNow(timezone, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, weekend: p.weekday === "Sat" || p.weekday === "Sun" };
}

function toSettings(r) {
  return r
    ? { enabled: r.enabled, time: r.time_hhmm, timezone: r.timezone, weekdaysOnly: r.weekdays_only, destination: r.destination, channelId: r.channel_id, channelName: r.channel_name }
    : { enabled: false, time: "09:00", timezone: null, weekdaysOnly: true, destination: "dm", channelId: null, channelName: null };
}

// Builds the reminder for one user as of their local `today`, or null when
// nothing is open. Snoozed tasks are left out unless their due date has come.
export async function buildReminder(db, userId, today, appUrl) {
  const [user] = await db.query("SELECT name FROM users WHERE id = $1", [userId]);
  const rows = await db.query(
    `SELECT t.text, t.priority, t.created_date, t.due_date, t.snoozed_until, b.name AS board
     FROM tasks t JOIN boards b ON b.id = t.board_id AND b.user_id = $1
     WHERE t.user_id = $1 AND t.status = 'open'`,
    [userId]
  );
  const open = rows.filter((t) => !(t.snoozed_until && t.snoozed_until > today && !(t.due_date && t.due_date <= today)));
  if (!open.length) return null;

  const overdue = open.filter((t) => t.due_date && t.due_date < today);
  const dueToday = open.filter((t) => t.due_date === today);
  const carried = open.filter((t) => t.created_date < today);
  const rank = (t) => (t.due_date && t.due_date < today ? 0 : t.due_date === today ? 1 : t.priority === "high" ? 2 : 3);
  const top = [...open].sort((a, b) =>
    rank(a) - rank(b) ||
    (a.due_date || "9999").localeCompare(b.due_date || "9999") ||
    a.created_date.localeCompare(b.created_date)
  ).slice(0, MAX_LISTED);
  const manyBoards = new Set(open.map((t) => t.board)).size > 1;

  const lines = top.map((t) => {
    let note;
    if (t.due_date && t.due_date < today) note = `overdue ${daysBetween(t.due_date, today)}d`;
    else if (t.due_date === today) note = "due today";
    else if (t.created_date < today) note = `carried ${daysBetween(t.created_date, today)}d`;
    else note = t.priority === "high" ? "high priority" : "new today";
    return `• ${slackEscape(t.text)} — _${note}_${manyBoards ? ` · ${slackEscape(t.board)}` : ""}`;
  });
  const firstName = slackEscape((user?.name || "").split(" ")[0] || "there");
  const counts = [
    overdue.length ? `🔴 ${overdue.length} overdue` : null,
    dueToday.length ? `🟠 ${dueToday.length} due today` : null,
    carried.length ? `↩️ ${carried.length} carried over` : null,
  ].filter(Boolean).join("  ·  ");
  const headline = `You have *${open.length} open task${open.length === 1 ? "" : "s"}* today`;
  const more = open.length > top.length ? `\n_…and ${open.length - top.length} more_` : "";

  const text = `Good morning, ${firstName}. ${headline.replace(/\*/g, "")}${counts ? " — " + counts : ""}.`;
  const blocks = [
    { type: "section", text: { type: "mrkdwn", text: `Good morning, ${firstName} ☀️\n${headline}${counts ? "\n" + counts : ""}` } },
    { type: "section", text: { type: "mrkdwn", text: `*Start with:*\n${lines.join("\n")}${more}` } },
    { type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open Task Organizer" }, url: appUrl }] },
  ];
  return { text, blocks };
}

// Where a user's reminder goes: their DM, or a channel they still belong to.
async function resolveTarget(db, slack, settings, userId) {
  let slackUserId = settings.slack_user_id;
  if (!slackUserId) {
    const [u] = await db.query("SELECT email FROM users WHERE id = $1", [userId]);
    slackUserId = await slack.lookupUserByEmail(u.email);
    await db.query("UPDATE reminders SET slack_user_id = $2 WHERE user_id = $1", [userId, slackUserId]);
  }
  if (settings.destination === "channel") {
    if (!settings.channel_id || !(await slack.isMember(settings.channel_id, slackUserId))) throw new SlackError("not_in_channel");
    return settings.channel_id;
  }
  return slackUserId;
}

async function sendFor(db, slack, cfg, settings, today, { force = false } = {}) {
  const message = await buildReminder(db, settings.user_id, today, cfg.publicUrl);
  if (!message && !force) return "nothing_open";
  const target = await resolveTarget(db, slack, settings, settings.user_id);
  const msg = message || { text: "Nothing open today. All clear! 🎉", blocks: undefined };
  await slack.post(target, msg.text, msg.blocks);
  return "sent";
}

// Sends every reminder that's due at `now`. Run once a minute.
export async function runDueReminders(db, slack, cfg, now = new Date()) {
  const due = await db.query("SELECT * FROM reminders WHERE enabled = true");
  let sent = 0;
  for (const r of due) {
    const local = localNow(r.timezone, now);
    if (r.last_sent_day === local.day || local.hhmm < r.time_hhmm || (r.weekdays_only && local.weekend)) continue;
    // Claim today first so a crash or a second server can't double-send.
    const claimed = await db.query(
      "UPDATE reminders SET last_sent_day = $2 WHERE user_id = $1 AND (last_sent_day IS NULL OR last_sent_day <> $2) RETURNING user_id",
      [r.user_id, local.day]
    );
    if (!claimed.length) continue;
    try {
      const result = await sendFor(db, slack, cfg, r, local.day);
      if (result === "sent") sent++;
      log("info", "reminder", { userId: r.user_id, destination: r.destination, result });
    } catch (err) {
      log("warn", "reminder", { userId: r.user_id, destination: r.destination, result: "failed", code: err.code || "error" });
    }
  }
  return sent;
}

export function startReminderLoop(db, slack, cfg) {
  const tick = () => runDueReminders(db, slack, cfg).catch((err) => log("error", "reminder_loop", { message: err.message }));
  const timer = setInterval(tick, 60_000);
  timer.unref();
  tick();
  return timer;
}

const SLACK_ERRORS = {
  users_not_found: "We couldn't find you in Slack by your work email.",
  not_in_channel: "You (or the Task Organizer bot) aren't in that channel any more.",
  channel_not_found: "That channel couldn't be found.",
};

export function remindersRouter(cfg, db, slack) {
  const r = express.Router();
  const enabled = !!slack;

  r.use(rateLimit({
    windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false,
    keyGenerator: (req) => req.session.userId,
  }));

  r.get("/", async (req, res, next) => {
    try {
      const [row] = await db.query("SELECT * FROM reminders WHERE user_id = $1", [req.session.userId]);
      res.json({ slackEnabled: enabled, settings: toSettings(row) });
    } catch (err) { next(err); }
  });

  r.use((req, res, next) => (enabled ? next() : res.status(503).json({ error: "slack_disabled" })));

  // Channels the person can pick: ones the bot was invited to that they're also in.
  r.get("/channels", async (req, res) => {
    try {
      const [u] = await db.query("SELECT email FROM users WHERE id = $1", [req.session.userId]);
      const me = await slack.lookupUserByEmail(u.email);
      const channels = [];
      for (const c of (await slack.botChannels()).slice(0, 50)) {
        if (await slack.isMember(c.id, me)) channels.push(c);
      }
      res.json({ channels });
    } catch (err) {
      log("warn", "slack_error", { reqId: req.id, userId: req.session.userId, code: err.code });
      res.status(502).json({ error: err.code || "slack_error", message: SLACK_ERRORS[err.code] });
    }
  });

  r.put("/", async (req, res) => {
    const uid = req.session.userId;
    const parsed = settingsBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "invalid_input" });
    const s = parsed.data;
    if (s.destination === "channel" && !s.channelId) return res.status(400).json({ error: "channel_required" });
    try {
      const [u] = await db.query("SELECT email FROM users WHERE id = $1", [uid]);
      const slackUserId = await slack.lookupUserByEmail(u.email);
      let channelName = null;
      if (s.destination === "channel") {
        const ch = (await slack.botChannels()).find((c) => c.id === s.channelId);
        if (!ch || !(await slack.isMember(s.channelId, slackUserId))) throw new SlackError("not_in_channel");
        channelName = ch.name;
      }
      // Turning it on after today's time has passed starts tomorrow, rather
      // than sending one straight away (that's what "Send a test" is for).
      const local = localNow(s.timezone);
      const startDay = s.enabled && local.hhmm >= s.time ? local.day : null;
      const [row] = await db.query(
        `INSERT INTO reminders (user_id, enabled, time_hhmm, timezone, weekdays_only, destination, channel_id, channel_name, slack_user_id, last_sent_day)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, time_hhmm = EXCLUDED.time_hhmm, timezone = EXCLUDED.timezone,
           weekdays_only = EXCLUDED.weekdays_only, destination = EXCLUDED.destination, channel_id = EXCLUDED.channel_id,
           channel_name = EXCLUDED.channel_name, slack_user_id = EXCLUDED.slack_user_id,
           last_sent_day = COALESCE(EXCLUDED.last_sent_day, reminders.last_sent_day)
         RETURNING *`,
        [uid, s.enabled, s.time, s.timezone, s.weekdaysOnly, s.destination, s.destination === "channel" ? s.channelId : null, channelName, slackUserId, startDay]
      );
      log("info", "reminder_settings", { reqId: req.id, userId: uid, enabled: s.enabled, destination: s.destination });
      res.json({ settings: toSettings(row) });
    } catch (err) {
      log("warn", "slack_error", { reqId: req.id, userId: uid, code: err.code });
      res.status(err instanceof SlackError ? 400 : 500).json({ error: err.code || "slack_error", message: SLACK_ERRORS[err.code] });
    }
  });

  // "Send a test now" — same message, same destination, right away.
  r.post("/test", rateLimit({
    windowMs: 10 * 60 * 1000, limit: 3, standardHeaders: "draft-7", legacyHeaders: false,
    keyGenerator: (req) => req.session.userId,
    handler: (req, res) => res.status(429).json({ error: "rate_limited" }),
  }), async (req, res) => {
    const uid = req.session.userId;
    try {
      const [row] = await db.query("SELECT * FROM reminders WHERE user_id = $1", [uid]);
      if (!row) return res.status(400).json({ error: "not_set_up" });
      await sendFor(db, slack, cfg, row, localNow(row.timezone).day, { force: true });
      log("info", "reminder", { reqId: req.id, userId: uid, destination: row.destination, result: "test_sent" });
      res.status(204).end();
    } catch (err) {
      log("warn", "slack_error", { reqId: req.id, userId: uid, code: err.code });
      res.status(502).json({ error: err.code || "slack_error", message: SLACK_ERRORS[err.code] });
    }
  });

  return r;
}
