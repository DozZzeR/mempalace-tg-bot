import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * State store (R-10): allowlist, project registry, per-user project sets.
 * Small, rarely changed, backed up by copying one file.
 *
 * `restricted` on a user is explicit on purpose. "No rows in user_projects"
 * must not silently mean either "everything" or "nothing" — an ambiguous
 * default in an access table is how people end up seeing what they should not.
 */

export type Database = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  telegram_user_id INTEGER PRIMARY KEY,
  display_name     TEXT    NOT NULL DEFAULT '',
  is_admin         INTEGER NOT NULL DEFAULT 0,
  -- 0: sees the whole registry. 1: sees only rows in user_projects.
  restricted       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  wing        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_projects (
  telegram_user_id INTEGER NOT NULL,
  project_id       TEXT    NOT NULL,
  PRIMARY KEY (telegram_user_id, project_id),
  FOREIGN KEY (telegram_user_id) REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id)       REFERENCES projects(id)            ON DELETE CASCADE
);

-- Someone who tried to use the bot without being admitted. Kept after a
-- decision rather than deleted, so a denial is a record and not an absence:
-- otherwise a denied person reappears as a fresh request every time they try.
CREATE TABLE IF NOT EXISTS access_requests (
  telegram_user_id INTEGER PRIMARY KEY,
  display_name     TEXT    NOT NULL DEFAULT '',
  requested_at     TEXT    NOT NULL,
  decided_at       TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending'
);

-- Admin powers are not ambient. An admin opens a session with a secret and it
-- expires; approving someone is then a deliberate act inside a window, not
-- something the account can do at any moment by tapping a button.
CREATE TABLE IF NOT EXISTS admin_sessions (
  telegram_user_id INTEGER PRIMARY KEY,
  expires_at       TEXT    NOT NULL
);
`;

export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}
