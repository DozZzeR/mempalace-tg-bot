/**
 * Administration for the live gateway: who may use the bot, and which wings
 * are published as projects.
 *
 *   npm run admin -- users
 *   npm run admin -- admit 331673208 "Alex"
 *   npm run admin -- projects
 *   npm run admin -- publish demo demo_wing "Демо-проект" "описание"
 *   npm run admin -- restrict 331673208 demo other
 *   npm run admin -- unrestrict 331673208
 *   npm run admin -- wings
 *
 * Every one of these is a disclosure decision — admitting a person, publishing
 * a wing, widening someone's set. They live in a deliberate command rather than
 * in the bot, so none of them can happen as a side effect of a conversation.
 */

import { loadConfig } from "../config.ts";
import { openDatabase } from "../state/db.ts";
import { Registry } from "../access/registry.ts";
import { ForbiddenWingError } from "../access/forbidden.ts";
import { httpPalace, stdioPalace } from "../palace/mcpAdapter.ts";

type Row = Record<string, unknown>;

function usage(): never {
  console.error(
    [
      "usage:",
      "  users",
      "  admit <telegramUserId> [displayName] [--admin]",
      "  projects",
      "  publish <projectId> <wing> <title> [description]",
      "  restrict <telegramUserId> <projectId...>",
      "  unrestrict <telegramUserId>",
      "  wings",
    ].join("\n"),
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === undefined) usage();

  const config = loadConfig();
  const db = openDatabase(config.statePath);
  const registry = new Registry(db);

  switch (command) {
    case "users": {
      const rows = db
        .prepare(
          `SELECT u.telegram_user_id AS id, u.display_name AS name,
                  u.is_admin AS admin, u.restricted AS restricted,
                  (SELECT group_concat(project_id, ' ') FROM user_projects p
                    WHERE p.telegram_user_id = u.telegram_user_id) AS projects
           FROM users u ORDER BY u.telegram_user_id`,
        )
        .all() as Row[];

      if (rows.length === 0) {
        console.log("no users admitted — nobody can use the bot yet");
        break;
      }
      for (const row of rows) {
        const scope =
          row["restricted"] === 1
            ? `only: ${row["projects"] ?? "(nothing)"}`
            : "all published projects";
        const admin = row["admin"] === 1 ? " [admin]" : "";
        console.log(`${row["id"]}  ${row["name"] || "(no name)"}${admin}  — ${scope}`);
      }
      break;
    }

    case "admit": {
      const id = Number(args[0]);
      if (!Number.isInteger(id)) usage();
      registry.admit({
        telegramUserId: id,
        displayName: args[1] ?? "",
        isAdmin: args.includes("--admin"),
      });
      console.log(`admitted ${id} — sees all published projects by default`);
      break;
    }

    case "projects": {
      const projects = registry.published();
      if (projects.length === 0) {
        console.log("no projects published — the bot would show no buttons");
        break;
      }
      for (const project of projects) {
        console.log(`${project.id}  ${project.title}`);
      }
      break;
    }

    case "publish": {
      const [id, wing, title, description] = args;
      if (!id || !wing || !title) usage();
      try {
        registry.publish({
          id,
          wing,
          title,
          ...(description === undefined ? {} : { description }),
        });
        console.log(`published ${id} -> wing ${wing}`);
      } catch (error) {
        if (error instanceof ForbiddenWingError) {
          console.error(`refused: ${error.message}`);
          process.exit(1);
        }
        throw error;
      }
      break;
    }

    case "restrict": {
      const id = Number(args[0]);
      const projectIds = args.slice(1);
      if (!Number.isInteger(id)) usage();
      registry.restrictTo(id, projectIds);
      console.log(
        projectIds.length === 0
          ? `${id} now sees nothing`
          : `${id} now sees only: ${projectIds.join(" ")}`,
      );
      break;
    }

    case "unrestrict": {
      const id = Number(args[0]);
      if (!Number.isInteger(id)) usage();
      registry.unrestrict(id);
      console.log(`${id} now sees all published projects`);
      break;
    }

    case "wings": {
      // Asks the palace what it actually has, so publishing does not rely on a
      // wing name someone remembered.
      const palace =
        config.palace.kind === "stdio"
          ? stdioPalace(config.palace)
          : httpPalace(config.palace);
      const wings = await palace.listWings();
      const published = new Set(
        (
          db.prepare(`SELECT wing FROM projects`).all() as Array<{ wing: string }>
        ).map((row) => row.wing),
      );
      for (const wing of wings.sort()) {
        console.log(`${published.has(wing) ? "[published]" : "           "} ${wing}`);
      }
      await palace.close();
      break;
    }

    default:
      usage();
  }

  db.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
