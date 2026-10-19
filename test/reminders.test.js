import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { createApp } from "../src/server.js";
import { runDueReminders, buildReminder, localNow } from "../src/reminders.js";
import { slackEscape, SlackError } from "../src/slack.js";

// Fake Slack: a directory of users and channels, recording every post.
const slackUsers = { "lena@qlub.io": "U_LENA", "omar@qlub.io": "U_OMAR" };
const channels = { CTEAM01: { name: "ops-team", members: ["U_LENA", "U_BOT"] }, COTHER01: { name: "finance", members: ["U_OMAR"] } };
const posts = [];
const fakeSlack = {
  async lookupUserByEmail(email) {
    if (!slackUsers[email]) throw new SlackError("users_not_found");
    return slackUsers[email];
  },
  async botChannels() { return Object.entries(channels).map(([id, c]) => ({ id, name: c.name, isPrivate: false })); },
  async isMember(id, user) { return !!channels[id]?.members.includes(user); },
  async post(channel, text, blocks) { posts.push({ channel, text, blocks }); },
};

let server, base, db, cfg;
before(async () => {
  cfg = loadConfig({ NODE_ENV: "test", DEV_LOGIN: "true", PGLITE_DIR: ":memory:" });
  db = await createDb(cfg);
  const app = await createApp(cfg, db, { slack: fakeSlack });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); });

function client() {
  let cookie = "";
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { "X-Requested-With": "fetch", "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}
async function signedIn(user) {
  const call = client();
  assert.equal((await call("POST", "/auth/dev-login", { user })).status, 204);
  return call;
}
const userId = async (handle) => (await db.query("SELECT id FROM users WHERE email = $1", [handle + "@qlub.io"]))[0].id;
const settings = (over = {}) => ({ enabled: true, time: "09:00", timezone: "Asia/Colombo", weekdaysOnly: true, destination: "dm", channelId: null, ...over });

test("localNow converts to the person's own timezone", () => {
  // 2026-10-19 03:45 UTC is 09:15 in Colombo (UTC+5:30), a Monday.
  assert.deepEqual(localNow("Asia/Colombo", new Date("2026-10-19T03:45:00Z")), { day: "2026-10-19", hhmm: "09:15", weekend: false });
  assert.deepEqual(localNow("Asia/Dubai", new Date("2026-10-19T03:45:00Z")), { day: "2026-10-19", hhmm: "07:45", weekend: false });
  assert.equal(localNow("Asia/Colombo", new Date("2026-10-24T05:00:00Z")).weekend, true);
});

test("the message lists overdue, due today and carried-over work, and escapes task text", async () => {
  const call = await signedIn("lena");
  const b = (await call("POST", "/api/boards", { name: "Ops" })).body;
  await call("POST", "/api/tasks", { text: "Ping <!channel> about <@U123> & co", board: b.id, createdDate: "2026-10-19" });
  await call("POST", "/api/tasks", { text: "Renewal quote", board: b.id, createdDate: "2026-10-15", dueDate: "2026-10-17" });
  await call("POST", "/api/tasks", { text: "Ops agenda", board: b.id, createdDate: "2026-10-18", dueDate: "2026-10-19" });
  await call("POST", "/api/tasks", { text: "Legal contract", priority: "high", board: b.id, createdDate: "2026-10-14" });
  await call("POST", "/api/tasks", { text: "Snoozed thing", board: b.id, createdDate: "2026-10-14", snoozedUntil: "2026-10-23" });

  const msg = await buildReminder(db, await userId("lena"), "2026-10-19", "https://tasks.example");
  const all = JSON.stringify(msg.blocks);
  assert.match(msg.text, /4 open tasks/);
  assert.match(all, /1 overdue/);
  assert.match(all, /1 due today/);
  assert.match(all, /3 carried over/);
  assert.doesNotMatch(all, /Snoozed thing/);
  // Order: overdue, due today, high priority, then the rest.
  const lines = msg.blocks[1].text.text.split("\n").slice(1);
  assert.match(lines[0], /Renewal quote — _overdue 2d_/);
  assert.match(lines[1], /Ops agenda — _due today_/);
  assert.match(lines[2], /Legal contract — _carried 5d_/);
  // No raw mention syntax survives.
  assert.doesNotMatch(all, /<!channel>|<@U123>/);
  assert.match(all, /&lt;!channel&gt;/);
  assert.equal(slackEscape("<a&b>"), "&lt;a&amp;b&gt;");
});

test("reminders send once a day at the person's time, skipping weekends", async () => {
  const call = await signedIn("lena");
  assert.equal((await call("PUT", "/api/reminders", settings())).status, 200);
  const uid = await userId("lena");
  await db.query("UPDATE reminders SET last_sent_day = NULL WHERE user_id = $1", [uid]); // as if saved before 9:00

  posts.length = 0;
  await runDueReminders(db, fakeSlack, cfg, new Date("2026-10-19T03:00:00Z")); // 08:30 Colombo
  assert.equal(posts.length, 0);
  await runDueReminders(db, fakeSlack, cfg, new Date("2026-10-19T03:31:00Z")); // 09:01
  await runDueReminders(db, fakeSlack, cfg, new Date("2026-10-19T03:40:00Z")); // again later: no repeat
  assert.equal(posts.length, 1);
  assert.equal(posts[0].channel, "U_LENA"); // DM
  await runDueReminders(db, fakeSlack, cfg, new Date("2026-10-24T04:00:00Z")); // Saturday
  assert.equal(posts.length, 1);
  await runDueReminders(db, fakeSlack, cfg, new Date("2026-10-26T04:00:00Z")); // Monday
  assert.equal(posts.length, 2);
});

test("channel delivery only to channels the person is in", async () => {
  const call = await signedIn("lena");
  const list = (await call("GET", "/api/reminders/channels")).body.channels;
  assert.deepEqual(list.map((c) => c.id), ["CTEAM01"]); // not #finance
  assert.equal((await call("PUT", "/api/reminders", settings({ destination: "channel", channelId: "COTHER01" }))).status, 400);
  assert.equal((await call("PUT", "/api/reminders", settings({ destination: "channel", channelId: null }))).status, 400);
  const ok = await call("PUT", "/api/reminders", settings({ destination: "channel", channelId: "CTEAM01" }));
  assert.equal(ok.body.settings.channelName, "ops-team");

  posts.length = 0;
  assert.equal((await call("POST", "/api/reminders/test")).status, 204);
  assert.equal(posts[0].channel, "CTEAM01");

  // Removed from the channel later: nothing is posted there.
  channels.CTEAM01.members = ["U_BOT"];
  assert.equal((await call("POST", "/api/reminders/test")).status, 502);
  assert.equal(posts.length, 1);
  channels.CTEAM01.members = ["U_LENA", "U_BOT"];
});

test("settings are validated and people missing from Slack get a clear error", async () => {
  const call = await signedIn("lena");
  assert.equal((await call("PUT", "/api/reminders", settings({ time: "25:00" }))).status, 400);
  assert.equal((await call("PUT", "/api/reminders", settings({ timezone: "Mars/Olympus" }))).status, 400);
  const ghost = await signedIn("ghost"); // not in the Slack directory
  const r = await ghost("PUT", "/api/reminders", settings());
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "users_not_found");
});

test("nothing is sent when nothing is open, and reminders are off without a Slack token", async () => {
  const call = await signedIn("omar");
  await call("PUT", "/api/reminders", settings());
  await db.query("UPDATE reminders SET last_sent_day = NULL WHERE user_id = $1", [await userId("omar")]);
  posts.length = 0;
  await runDueReminders(db, fakeSlack, cfg, new Date("2026-10-20T04:00:00Z"));
  assert.ok(!posts.some((p) => p.channel === "U_OMAR"));

  const offApp = await createApp(cfg, db);
  const offServer = await new Promise((resolve) => { const s = offApp.listen(0, () => resolve(s)); });
  const res = await fetch(`http://localhost:${offServer.address().port}/api/reminders`, { headers: { "X-Requested-With": "fetch" } });
  assert.equal(res.status, 401); // still needs sign-in
  offServer.close();
});
