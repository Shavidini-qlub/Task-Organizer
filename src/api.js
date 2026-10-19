// JSON API for boards, tasks and reviews. Every query is scoped to the
// signed-in user (req.session.userId); there is no way to address another
// user's rows. Field names match what the front end already uses.
import crypto from "node:crypto";
import express from "express";
import { z } from "zod";

const MAX_BOARDS = 50;
const MAX_TASKS = 5000;

const uuid = z.uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const priority = z.enum(["low", "medium", "high"]);
const smallInt = z.number().int().min(0).max(100000);
const reviewId = z.string().regex(/^[0-9a-f-]{36}_(m_)?\d{4}-\d{2}-\d{2}$/);

const boardCreate = z.object({ name: z.string().trim().min(1).max(40), order: smallInt.optional() });
const boardPatch = z.strictObject({
  name: z.string().trim().min(1).max(40).optional(),
  order: smallInt.optional(),
  manualSort: z.boolean().optional(),
});
const taskCreate = z.object({
  text: z.string().trim().min(1).max(300),
  priority: priority.default("low"),
  comment: z.string().max(500).default(""),
  board: uuid,
  createdDate: dateStr,
  dueDate: dateStr.nullable().default(null),
});
const taskPatch = z.strictObject({
  text: z.string().trim().min(1).max(300).optional(),
  status: z.enum(["open", "done"]).optional(),
  priority: priority.optional(),
  comment: z.string().max(500).optional(),
  board: uuid.optional(),
  doneDate: dateStr.nullable().optional(),
  dueDate: dateStr.nullable().optional(),
  manualOrder: smallInt.optional(),
});
const reviewPut = z.object({
  board: uuid,
  notes: z.string().max(5000).default(""),
  reviewedAt: z.number().int().positive().nullable().default(null),
});

const TASK_COLS = { text: "text", status: "status", priority: "priority", comment: "comment", board: "board_id", doneDate: "done_date", dueDate: "due_date", manualOrder: "manual_order" };
const BOARD_COLS = { name: "name", order: "sort_order", manualSort: "manual_sort" };

const toBoard = (r) => ({ id: r.id, name: r.name, createdAt: Number(r.created_at), order: r.sort_order, manualSort: r.manual_sort });
const toTask = (r) => ({
  id: r.id, text: r.text, status: r.status, priority: r.priority, comment: r.comment, board: r.board_id,
  createdDate: r.created_date, doneDate: r.done_date, dueDate: r.due_date, createdAt: Number(r.created_at), manualOrder: r.manual_order,
});
const toReview = (r) => ({ id: r.id, board: r.board_id, notes: r.notes, reviewedAt: r.reviewed_at == null ? null : Number(r.reviewed_at) });

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function parse(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, "invalid_input");
  return result.data;
}

function parseId(id) {
  if (!uuid.safeParse(id).success) throw new HttpError(404, "not_found");
  return id;
}

// Builds "col1 = $3, col2 = $4" from a validated patch and a whitelist of
// column names, so no user input ever becomes SQL text.
function setClause(patch, cols, offset) {
  const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (!keys.length) throw new HttpError(400, "empty_patch");
  return { sql: keys.map((k, i) => `${cols[k]} = $${i + offset}`).join(", "), values: keys.map((k) => patch[k]) };
}

async function assertOwnBoard(db, userId, boardId) {
  const rows = await db.query("SELECT 1 FROM boards WHERE id = $1 AND user_id = $2", [boardId, userId]);
  if (!rows.length) throw new HttpError(400, "unknown_board");
}

export function apiRouter(db) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => fn(req, res, req.session.userId).catch(next);

  r.get("/me", wrap(async (req, res, uid) => {
    const rows = await db.query("SELECT name, email FROM users WHERE id = $1", [uid]);
    if (!rows.length) throw new HttpError(401, "unauthenticated");
    res.json({ name: rows[0].name, email: rows[0].email });
  }));

  // ---------- boards ----------
  r.get("/boards", wrap(async (req, res, uid) => {
    const rows = await db.query("SELECT * FROM boards WHERE user_id = $1 ORDER BY sort_order, created_at", [uid]);
    res.json(rows.map(toBoard));
  }));
  r.post("/boards", wrap(async (req, res, uid) => {
    const body = parse(boardCreate, req.body);
    const [{ n }] = await db.query("SELECT count(*)::int AS n FROM boards WHERE user_id = $1", [uid]);
    if (n >= MAX_BOARDS) throw new HttpError(409, "board_limit");
    const rows = await db.query(
      "INSERT INTO boards (id, user_id, name, created_at, sort_order) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [crypto.randomUUID(), uid, body.name, Date.now(), body.order ?? n]
    );
    res.status(201).json(toBoard(rows[0]));
  }));
  r.patch("/boards/:id", wrap(async (req, res, uid) => {
    const id = parseId(req.params.id);
    const set = setClause(parse(boardPatch, req.body), BOARD_COLS, 3);
    const rows = await db.query(`UPDATE boards SET ${set.sql} WHERE id = $1 AND user_id = $2 RETURNING *`, [id, uid, ...set.values]);
    if (!rows.length) throw new HttpError(404, "not_found");
    res.json(toBoard(rows[0]));
  }));
  // Tasks and reviews on the board go with it (ON DELETE CASCADE).
  r.delete("/boards/:id", wrap(async (req, res, uid) => {
    const id = parseId(req.params.id);
    const rows = await db.query("DELETE FROM boards WHERE id = $1 AND user_id = $2 RETURNING id", [id, uid]);
    if (!rows.length) throw new HttpError(404, "not_found");
    res.status(204).end();
  }));

  // ---------- tasks ----------
  r.get("/tasks", wrap(async (req, res, uid) => {
    const rows = await db.query("SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at LIMIT $2", [uid, MAX_TASKS]);
    res.json(rows.map(toTask));
  }));
  r.post("/tasks", wrap(async (req, res, uid) => {
    const body = parse(taskCreate, req.body);
    await assertOwnBoard(db, uid, body.board);
    const [{ n }] = await db.query("SELECT count(*)::int AS n FROM tasks WHERE user_id = $1", [uid]);
    if (n >= MAX_TASKS) throw new HttpError(409, "task_limit");
    const rows = await db.query(
      `INSERT INTO tasks (id, user_id, board_id, text, status, priority, comment, created_date, due_date, created_at)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8, $9) RETURNING *`,
      [crypto.randomUUID(), uid, body.board, body.text, body.priority, body.comment.trim(), body.createdDate, body.dueDate, Date.now()]
    );
    res.status(201).json(toTask(rows[0]));
  }));
  r.patch("/tasks/:id", wrap(async (req, res, uid) => {
    const id = parseId(req.params.id);
    const patch = parse(taskPatch, req.body);
    if (patch.board) await assertOwnBoard(db, uid, patch.board);
    if (patch.comment !== undefined) patch.comment = patch.comment.trim();
    const set = setClause(patch, TASK_COLS, 3);
    const rows = await db.query(`UPDATE tasks SET ${set.sql} WHERE id = $1 AND user_id = $2 RETURNING *`, [id, uid, ...set.values]);
    if (!rows.length) throw new HttpError(404, "not_found");
    res.json(toTask(rows[0]));
  }));
  r.delete("/tasks/:id", wrap(async (req, res, uid) => {
    const id = parseId(req.params.id);
    const rows = await db.query("DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id", [id, uid]);
    if (!rows.length) throw new HttpError(404, "not_found");
    res.status(204).end();
  }));

  // ---------- reviews (weekly + monthly notes) ----------
  r.get("/reviews", wrap(async (req, res, uid) => {
    const rows = await db.query("SELECT * FROM reviews WHERE user_id = $1 LIMIT 2000", [uid]);
    res.json(rows.map(toReview));
  }));
  r.put("/reviews/:id", wrap(async (req, res, uid) => {
    const id = parse(reviewId, req.params.id);
    const body = parse(reviewPut, req.body);
    if (!id.startsWith(body.board + "_")) throw new HttpError(400, "invalid_input");
    await assertOwnBoard(db, uid, body.board);
    const rows = await db.query(
      `INSERT INTO reviews (user_id, id, board_id, notes, reviewed_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, id) DO UPDATE SET notes = EXCLUDED.notes, reviewed_at = EXCLUDED.reviewed_at
       RETURNING *`,
      [uid, id, body.board, body.notes, body.reviewedAt]
    );
    res.json(toReview(rows[0]));
  }));

  r.use((req, res) => res.status(404).json({ error: "not_found" }));
  return r;
}

export { HttpError };
