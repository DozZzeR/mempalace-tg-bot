/**
 * Palace Gateway — entry point. Composition root: this is the only place where
 * concrete implementations are chosen and wired together.
 */

import type { ErrorResponse } from "@mempalace-bot/contract";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./state/db.ts";
import { Registry } from "./access/registry.ts";
import { AdminStore } from "./access/admin.ts";
import { httpPalace, stdioPalace } from "./palace/mcpAdapter.ts";
import { CodexModel } from "./model/codexModel.ts";
import { AnswerService } from "./answer/answerService.ts";
import { buildServer } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = openDatabase(config.statePath);
  const registry = new Registry(db);
  const palace =
    config.palace.kind === "stdio"
      ? stdioPalace(config.palace)
      : httpPalace(config.palace);

  const answers = new AnswerService(
    config.model === undefined ? undefined : new CodexModel(config.model),
  );
  console.log(
    config.model === undefined
      ? "reasoning layer off — verbatim search"
      : `reasoning layer on — ${config.model.model}`,
  );

  const admin =
    config.admin === undefined
      ? undefined
      : new AdminStore({
          db,
          registry,
          secret: config.admin.secret,
          ttlMs: config.admin.ttlMs,
        });
  console.log(
    admin === undefined
      ? "admin surface off — set ADMIN_SECRET to enable"
      : "admin surface on",
  );

  const app = buildServer({
    registry,
    palace,
    token: config.token,
    answers,
    ...(admin === undefined || config.admin === undefined
      ? {}
      : { admin, adminTtlMs: config.admin.ttlMs }),
    logger: true,
  });

  await app.listen({ port: config.port, host: "127.0.0.1" });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

// Kept so the contract package stays a compile-time dependency of the entry
// point; the shape below is what every error route answers with.
export type { ErrorResponse };
