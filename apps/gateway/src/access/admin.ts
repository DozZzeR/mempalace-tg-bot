import type { Database } from "../state/db.ts";
import type { Registry } from "./registry.ts";
import { verifySecret } from "./secretHash.ts";

/**
 * Admin state: pending access requests, and time-limited admin sessions.
 *
 * The session is the point. Approving someone is a disclosure decision, and an
 * account that can approve at any moment turns every stray tap into one. An
 * admin has to open a session with a secret, it expires, and every privileged
 * route checks it — so the power exists only inside a window the admin chose
 * to open.
 */

export type AccessRequest = {
  telegramUserId: number;
  displayName: string;
  requestedAt: string;
  status: "pending" | "approved" | "denied";
};

export type AdminUser = {
  telegramUserId: number;
  displayName: string;
  isAdmin: boolean;
  restricted: boolean;
  projectIds: string[];
};

export class AdminStore {
  readonly #db: Database;
  readonly #registry: Registry;
  readonly #secret: string;
  readonly #ttlMs: number;

  constructor(input: {
    db: Database;
    registry: Registry;
    secret: string;
    ttlMs: number;
  }) {
    this.#db = input.db;
    this.#registry = input.registry;
    this.#secret = input.secret;
    this.#ttlMs = input.ttlMs;
  }

  /**
   * Records that someone asked for access. Idempotent per person, and it never
   * revives a decided request — a denial should not be undone by the denied
   * person simply trying again.
   */
  requestAccess(telegramUserId: number, displayName: string): void {
    this.#db
      .prepare(
        `INSERT INTO access_requests (telegram_user_id, display_name, requested_at, status)
         VALUES (?, ?, ?, 'pending')
         ON CONFLICT(telegram_user_id) DO UPDATE SET
           display_name = excluded.display_name
         WHERE access_requests.status = 'pending'`,
      )
      .run(telegramUserId, displayName, new Date().toISOString());
  }

  pending(): AccessRequest[] {
    const rows = this.#db
      .prepare(
        `SELECT telegram_user_id, display_name, requested_at, status
         FROM access_requests WHERE status = 'pending'
         ORDER BY requested_at`,
      )
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      telegramUserId: Number(row["telegram_user_id"]),
      displayName: String(row["display_name"] ?? ""),
      requestedAt: String(row["requested_at"] ?? ""),
      status: "pending",
    }));
  }

  decide(telegramUserId: number, approve: boolean): boolean {
    const row = this.#db
      .prepare(
        `SELECT display_name FROM access_requests
         WHERE telegram_user_id = ? AND status = 'pending'`,
      )
      .get(telegramUserId) as { display_name: string } | undefined;
    if (row === undefined) return false;

    this.#db
      .prepare(
        `UPDATE access_requests SET status = ?, decided_at = ?
         WHERE telegram_user_id = ?`,
      )
      .run(approve ? "approved" : "denied", new Date().toISOString(), telegramUserId);

    if (approve) {
      this.#registry.admit({
        telegramUserId,
        displayName: row.display_name,
      });
    }
    return true;
  }

  users(): AdminUser[] {
    const rows = this.#db
      .prepare(
        `SELECT telegram_user_id, display_name, is_admin, restricted
         FROM users ORDER BY telegram_user_id`,
      )
      .all() as Array<Record<string, unknown>>;

    const grants = this.#db
      .prepare(`SELECT telegram_user_id, project_id FROM user_projects`)
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => {
      const id = Number(row["telegram_user_id"]);
      return {
        telegramUserId: id,
        displayName: String(row["display_name"] ?? ""),
        isAdmin: row["is_admin"] === 1,
        restricted: row["restricted"] === 1,
        projectIds: grants
          .filter((grant) => Number(grant["telegram_user_id"]) === id)
          .map((grant) => String(grant["project_id"])),
      };
    });
  }

  /**
   * Sets exactly which projects a user sees. `undefined` means "the whole
   * registry"; a list — including an empty one — means restricted to it.
   */
  setProjects(telegramUserId: number, projectIds: string[] | undefined): void {
    if (projectIds === undefined) {
      this.#registry.unrestrict(telegramUserId);
      return;
    }
    // restrictTo filters against the registry itself, so nothing is needed here.
    this.#registry.restrictTo(telegramUserId, projectIds);
  }

  /**
   * Publishes a wing as a project, deriving the identifier from the wing name.
   * Deriving rather than asking keeps the two from drifting apart and removes
   * a field an admin could mistype into a project nobody can reach.
   */
  publish(wing: string, title: string): string {
    const id = slugify(wing);
    this.#registry.publish({ id, wing, title: title.trim().slice(0, 80) || wing });
    return id;
  }

  unpublish(projectId: string): void {
    // Grants reference projects, so removing one has to clear them too or the
    // rows outlive their subject and reappear if the id is ever reused.
    this.#db
      .prepare(`DELETE FROM user_projects WHERE project_id = ?`)
      .run(projectId);
    this.#db.prepare(`DELETE FROM projects WHERE id = ?`).run(projectId);
  }

  /**
   * Opens a session if the phrase matches the stored hash. Async because
   * verification is deliberately slow — that cost is what makes a memorable
   * phrase safe to use.
   */
  async openSession(telegramUserId: number, phrase: string): Promise<boolean> {
    const caller = this.#registry.caller(telegramUserId);
    if (caller?.isAdmin !== true) return false;
    if (!(await verifySecret(phrase, this.#secret))) return false;

    this.#db
      .prepare(
        `INSERT INTO admin_sessions (telegram_user_id, expires_at) VALUES (?, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET expires_at = excluded.expires_at`,
      )
      .run(telegramUserId, new Date(Date.now() + this.#ttlMs).toISOString());
    return true;
  }

  closeSession(telegramUserId: number): void {
    this.#db
      .prepare(`DELETE FROM admin_sessions WHERE telegram_user_id = ?`)
      .run(telegramUserId);
  }

  /**
   * True only for an admin whose session has not expired, and extends it.
   *
   * Sliding rather than fixed: the window is short so a forgotten session
   * closes itself, but an admin working through a queue of requests should not
   * be thrown out mid-task and made to retype the phrase. Idle time is what
   * should end a session, not elapsed time.
   */
  hasSession(telegramUserId: number): boolean {
    const caller = this.#registry.caller(telegramUserId);
    if (caller?.isAdmin !== true) return false;

    const row = this.#db
      .prepare(`SELECT expires_at FROM admin_sessions WHERE telegram_user_id = ?`)
      .get(telegramUserId) as { expires_at: string } | undefined;
    if (row === undefined) return false;

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      this.closeSession(telegramUserId);
      return false;
    }

    this.#extend(telegramUserId);
    return true;
  }

  /** When the current session runs out, or undefined if there is none. */
  expiresAt(telegramUserId: number): string | undefined {
    const row = this.#db
      .prepare(`SELECT expires_at FROM admin_sessions WHERE telegram_user_id = ?`)
      .get(telegramUserId) as { expires_at: string } | undefined;
    return row?.expires_at;
  }

  #extend(telegramUserId: number): void {
    this.#db
      .prepare(`UPDATE admin_sessions SET expires_at = ? WHERE telegram_user_id = ?`)
      .run(new Date(Date.now() + this.#ttlMs).toISOString(), telegramUserId);
  }
}

function slugify(wing: string): string {
  return wing.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

