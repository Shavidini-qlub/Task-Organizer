// Postgres access. Production uses a real Postgres (DATABASE_URL); local
// development without one falls back to PGlite, an embedded Postgres, so
// the same SQL runs in both places.
import pg from "pg";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY,
     google_sub text UNIQUE NOT NULL,
     email text NOT NULL,
     name text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now(),
     last_login_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS boards (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name text NOT NULL,
     created_at bigint NOT NULL,
     sort_order integer NOT NULL DEFAULT 0,
     manual_sort boolean NOT NULL DEFAULT false
   )`,
  `CREATE INDEX IF NOT EXISTS boards_user_idx ON boards(user_id)`,
  `CREATE TABLE IF NOT EXISTS tasks (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
     text text NOT NULL,
     status text NOT NULL CHECK (status IN ('open', 'done')),
     priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high')),
     comment text NOT NULL DEFAULT '',
     created_date text NOT NULL,
     done_date text,
     created_at bigint NOT NULL,
     manual_order integer NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks(user_id)`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date text`,
  `CREATE TABLE IF NOT EXISTS reviews (
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     id text NOT NULL,
     board_id uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
     notes text NOT NULL DEFAULT '',
     reviewed_at bigint,
     PRIMARY KEY (user_id, id)
   )`,
];

export async function createDb(cfg) {
  let query, close, pool = null;
  if (cfg.databaseUrl) {
    pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 });
    query = async (text, params) => (await pool.query(text, params)).rows;
    close = () => pool.end();
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const lite = new PGlite(cfg.pgliteDir === ":memory:" ? undefined : cfg.pgliteDir);
    await lite.waitReady;
    query = async (text, params) => (await lite.query(text, params)).rows;
    close = () => lite.close();
  }
  for (const stmt of SCHEMA) await query(stmt);
  return { query, close, pool };
}
