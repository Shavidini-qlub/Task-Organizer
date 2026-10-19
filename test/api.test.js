import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db.js";
import { createApp } from "../src/server.js";

let server, base, db;

before(async () => {
  const cfg = loadConfig({ NODE_ENV: "test", DEV_LOGIN: "true", PGLITE_DIR: ":memory:", PORT: "0" });
  db = await createDb(cfg);
  const app = await createApp(cfg, db);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://localhost:${server.address().port}`;
  cfg.publicOrigin = base;
});
after(async () => {
  server.close();
  await db.close();
});

// Minimal cookie-keeping client for one signed-in user.
function client() {
  let cookie = "";
  return async function call(method, path, body, headers = {}) {
    const res = await fetch(base + path, {
      method,
      redirect: "manual",
      headers: {
        "X-Requested-With": "fetch",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
}

async function signedIn(user) {
  const call = client();
  const r = await call("POST", "/auth/dev-login", { user });
  assert.equal(r.status, 204);
  return call;
}

test("API requires sign-in and the page redirects to /login", async () => {
  const anon = client();
  assert.equal((await anon("GET", "/api/tasks")).status, 401);
  assert.equal((await anon("POST", "/api/tasks", { text: "x" })).status, 401);
  const page = await fetch(base + "/", { redirect: "manual" });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get("location"), "/login");
});

test("session cookie is httpOnly and SameSite=Lax", async () => {
  const res = await fetch(base + "/auth/dev-login", { method: "POST", headers: { "X-Requested-With": "fetch" } });
  const set = res.headers.get("set-cookie");
  assert.match(set, /HttpOnly/i);
  assert.match(set, /SameSite=Lax/i);
});

test("create, update, carry over and complete a task", async () => {
  const call = await signedIn("alice");
  const board = await call("POST", "/api/boards", { name: "Ops" });
  assert.equal(board.status, 201);
  const t = await call("POST", "/api/tasks", { text: "Chase follow-up", priority: "high", board: board.body.id, createdDate: "2026-10-12" });
  assert.equal(t.status, 201);
  assert.equal(t.body.status, "open");
  // An open task from an earlier day is still returned until completed.
  let list = await call("GET", "/api/tasks");
  assert.ok(list.body.some((x) => x.id === t.body.id && x.status === "open" && x.createdDate === "2026-10-12"));
  const done = await call("PATCH", `/api/tasks/${t.body.id}`, { status: "done", doneDate: "2026-10-19" });
  assert.equal(done.body.status, "done");
  assert.equal(done.body.doneDate, "2026-10-19");
  const review = await call("PUT", `/api/reviews/${board.body.id}_2026-10-19`, { board: board.body.id, notes: "Good week", reviewedAt: Date.now() });
  assert.equal(review.status, 200);
  assert.equal(review.body.notes, "Good week");
});

test("users cannot see or change each other's data", async () => {
  const alice = await signedIn("alice2");
  const bob = await signedIn("bob");
  const aBoard = (await alice("POST", "/api/boards", { name: "Alice" })).body;
  const aTask = (await alice("POST", "/api/tasks", { text: "private", board: aBoard.id, createdDate: "2026-10-19" })).body;
  const bBoard = (await bob("POST", "/api/boards", { name: "Bob" })).body;

  assert.ok(!(await bob("GET", "/api/tasks")).body.some((x) => x.id === aTask.id));
  assert.ok(!(await bob("GET", "/api/boards")).body.some((x) => x.id === aBoard.id));
  assert.equal((await bob("PATCH", `/api/tasks/${aTask.id}`, { text: "hacked" })).status, 404);
  assert.equal((await bob("DELETE", `/api/tasks/${aTask.id}`)).status, 404);
  assert.equal((await bob("DELETE", `/api/boards/${aBoard.id}`)).status, 404);
  // Bob can't file a task under Alice's board, nor move Alice's task into his.
  assert.equal((await bob("POST", "/api/tasks", { text: "x", board: aBoard.id, createdDate: "2026-10-19" })).status, 400);
  assert.equal((await alice("PATCH", `/api/tasks/${aTask.id}`, { board: bBoard.id })).status, 400);
  assert.equal((await bob("PUT", `/api/reviews/${aBoard.id}_2026-10-19`, { board: aBoard.id, notes: "x" })).status, 400);

  const still = (await alice("GET", "/api/tasks")).body.find((x) => x.id === aTask.id);
  assert.equal(still.text, "private");
});

test("deleting a board removes its tasks", async () => {
  const call = await signedIn("carol");
  const b = (await call("POST", "/api/boards", { name: "Temp" })).body;
  await call("POST", "/api/tasks", { text: "gone soon", board: b.id, createdDate: "2026-10-19" });
  assert.equal((await call("DELETE", `/api/boards/${b.id}`)).status, 204);
  assert.equal((await call("GET", "/api/tasks")).body.filter((x) => x.board === b.id).length, 0);
});

test("state changes need the CSRF header and our own Origin", async () => {
  const call = await signedIn("dave");
  assert.equal((await call("POST", "/api/boards", { name: "x" }, { "X-Requested-With": "" })).status, 403);
  assert.equal((await call("POST", "/api/boards", { name: "x" }, { Origin: "https://evil.example" })).status, 403);
});

test("input is validated", async () => {
  const call = await signedIn("erin");
  const b = (await call("POST", "/api/boards", { name: "V" })).body;
  assert.equal((await call("POST", "/api/tasks", { text: "x".repeat(301), board: b.id, createdDate: "2026-10-19" })).status, 400);
  assert.equal((await call("POST", "/api/tasks", { text: "ok", board: b.id, createdDate: "19/10/2026" })).status, 400);
  assert.equal((await call("POST", "/api/tasks", { text: "ok", board: b.id, createdDate: "2026-10-19", priority: "urgent" })).status, 400);
  assert.equal((await call("PATCH", "/api/tasks/not-a-uuid", { text: "x" })).status, 404);
  assert.equal((await call("PATCH", `/api/boards/${b.id}`, { user_id: "x" })).status, 400);
  assert.equal((await call("POST", "/api/boards", { name: "   " })).status, 400);
});

test("security headers are set", async () => {
  const res = await fetch(base + "/login");
  assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-powered-by"), null);
});

test("production config refuses unsafe settings", () => {
  const good = { NODE_ENV: "production", DATABASE_URL: "postgres://x", SESSION_SECRET: "a".repeat(32), GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", PUBLIC_URL: "https://tasks.qlubapps.com" };
  assert.doesNotThrow(() => loadConfig(good));
  assert.throws(() => loadConfig({ ...good, DEV_LOGIN: "true" }), /DEV_LOGIN/);
  assert.throws(() => loadConfig({ ...good, SESSION_SECRET: "short" }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ ...good, PUBLIC_URL: "http://tasks.qlubapps.com" }), /https/);
  assert.throws(() => loadConfig({ ...good, GOOGLE_CLIENT_SECRET: "" }), /GOOGLE/);
});
