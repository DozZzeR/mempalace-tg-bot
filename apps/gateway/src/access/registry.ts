import type { Project, ProjectId } from "@mempalace-bot/contract";
import type { Database } from "../state/db.ts";
import { ForbiddenWingError, isForbiddenWing } from "./forbidden.ts";
import { wingFromRegistry, type Wing } from "../palace/noteTarget.ts";

/**
 * The project registry (R-7) — the only place a wing name enters the system,
 * and the only minter of `Wing`. A user's maximum is this registry, never
 * "every wing in the palace": a wing nobody published must not surface.
 */

type ProjectRow = {
  id: string;
  wing: string;
  title: string;
  description: string | null;
};

type UserRow = {
  telegram_user_id: number;
  display_name: string;
  is_admin: number;
  restricted: number;
};

export type Caller = {
  id: number;
  displayName: string;
  isAdmin: boolean;
};

export class Registry {
  // Written out rather than as a parameter property: Node strips types at load
  // and cannot erase those. `erasableSyntaxOnly` in tsconfig catches it.
  private readonly db: Database;

  /**
   * Admins come from configuration (ADMIN_IDS), not from a row anyone can
   * write. Two consequences, both wanted: nothing reachable at runtime can
   * promote an account, and a fresh database still has an owner — there is no
   * bootstrap step where the system exists but nobody can administer it.
   */
  private readonly adminIds: ReadonlySet<number>;

  constructor(db: Database, adminIds: Iterable<number> = []) {
    this.db = db;
    this.adminIds = new Set(adminIds);
  }

  /**
   * Publishes a wing as a project. Rejects forbidden wings outright — the check
   * lives here rather than at the call sites so it cannot be forgotten.
   */
  publish(input: {
    id: ProjectId;
    wing: string;
    title: string;
    description?: string;
  }): void {
    if (isForbiddenWing(input.wing)) {
      throw new ForbiddenWingError(input.wing);
    }
    this.db
      .prepare(
        `INSERT INTO projects (id, wing, title, description, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           wing = excluded.wing,
           title = excluded.title,
           description = excluded.description`,
      )
      .run(
        input.id,
        input.wing,
        input.title,
        input.description ?? null,
        new Date().toISOString(),
      );
  }

  /**
   * Admits a user to the bot — cut 1 of the access model. `isAdmin` is stored
   * for the record only; whether someone is an admin is decided by ADMIN_IDS.
   */
  admit(input: {
    telegramUserId: number;
    displayName?: string;
    isAdmin?: boolean;
  }): void {
    this.db
      .prepare(
        `INSERT INTO users (telegram_user_id, display_name, is_admin, restricted, created_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(telegram_user_id) DO UPDATE SET
           display_name = excluded.display_name,
           is_admin = excluded.is_admin`,
      )
      .run(
        input.telegramUserId,
        input.displayName ?? "",
        input.isAdmin === true ? 1 : 0,
        new Date().toISOString(),
      );
  }

  /**
   * Narrows a user to an explicit set of projects. Passing an empty list means
   * they see nothing — which is a legitimate thing to want, and is why the
   * restriction is a flag rather than "no rows means no access".
   */
  restrictTo(telegramUserId: number, projectIds: ProjectId[]): void {
    this.db
      .prepare(`UPDATE users SET restricted = 1 WHERE telegram_user_id = ?`)
      .run(telegramUserId);
    this.db
      .prepare(`DELETE FROM user_projects WHERE telegram_user_id = ?`)
      .run(telegramUserId);
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO user_projects (telegram_user_id, project_id) VALUES (?, ?)`,
    );
    for (const projectId of projectIds) {
      insert.run(telegramUserId, projectId);
    }
  }

  /** Returns a user to the default: the whole registry. */
  unrestrict(telegramUserId: number): void {
    this.db
      .prepare(`UPDATE users SET restricted = 0 WHERE telegram_user_id = ?`)
      .run(telegramUserId);
    this.db
      .prepare(`DELETE FROM user_projects WHERE telegram_user_id = ?`)
      .run(telegramUserId);
  }

  /** Every published project, regardless of who is asking. Admin surface only. */
  published(): Project[] {
    const rows = this.db
      .prepare(`SELECT id, wing, title, description FROM projects ORDER BY title`)
      .all() as ProjectRow[];
    return rows.filter((row) => !isForbiddenWing(row.wing)).map(toProject);
  }

  /**
   * The caller, if they are on the allowlist. Undefined means "not admitted".
   *
   * A configured admin is admitted implicitly, with or without a row. Locking
   * the owner out of their own bot by editing a table is not a state worth
   * being able to reach.
   */
  caller(telegramUserId: number): Caller | undefined {
    const row = this.db
      .prepare(
        `SELECT telegram_user_id, display_name, is_admin, restricted
         FROM users WHERE telegram_user_id = ?`,
      )
      .get(telegramUserId) as UserRow | undefined;

    if (this.adminIds.has(telegramUserId)) {
      return {
        id: telegramUserId,
        displayName: row?.display_name ?? "",
        isAdmin: true,
      };
    }

    if (row === undefined) return undefined;
    return {
      id: row.telegram_user_id,
      displayName: row.display_name,
      isAdmin: false,
    };
  }

  /**
   * The projects this user may see — cut 3 of the access model. An unrestricted
   * user gets the whole registry; a restricted one gets only what was granted.
   */
  visibleTo(telegramUserId: number): Project[] {
    // A configured admin always sees the whole registry, row or not. Checked
    // before the row is read on purpose: otherwise an admin who happens to
    // have been restricted earlier would see less than the same admin with no
    // row at all, which is the sort of inconsistency that gets discovered at
    // the worst moment.
    if (this.adminIds.has(telegramUserId)) return this.published();

    const user = this.db
      .prepare(`SELECT restricted FROM users WHERE telegram_user_id = ?`)
      .get(telegramUserId) as { restricted: number } | undefined;
    if (user === undefined) return [];

    const rows = (
      user.restricted === 1
        ? this.db
            .prepare(
              `SELECT p.id, p.wing, p.title, p.description
               FROM projects p
               JOIN user_projects up ON up.project_id = p.id
               WHERE up.telegram_user_id = ?
               ORDER BY p.title`,
            )
            .all(telegramUserId)
        : this.db
            .prepare(
              `SELECT id, wing, title, description FROM projects ORDER BY title`,
            )
            .all()
    ) as ProjectRow[];

    return rows.filter((row) => !isForbiddenWing(row.wing)).map(toProject);
  }

  /**
   * Resolves a project id to its wing, for this caller only. Returns undefined
   * when the project does not exist, is forbidden, or is outside the caller's
   * set — the three cases are deliberately indistinguishable to the caller, so
   * a response cannot leak the existence of a project they may not see.
   *
   * This is the sole path from an incoming identifier to a `Wing`.
   */
  resolveWingFor(telegramUserId: number, projectId: ProjectId): Wing | undefined {
    const visible = this.visibleTo(telegramUserId);
    if (!visible.some((project) => project.id === projectId)) return undefined;

    const row = this.db
      .prepare(`SELECT wing FROM projects WHERE id = ?`)
      .get(projectId) as { wing: string } | undefined;
    if (row === undefined || isForbiddenWing(row.wing)) return undefined;

    return wingFromRegistry(row.wing);
  }
}

function toProject(row: ProjectRow): Project {
  return row.description === null
    ? { id: row.id, title: row.title }
    : { id: row.id, title: row.title, description: row.description };
}
