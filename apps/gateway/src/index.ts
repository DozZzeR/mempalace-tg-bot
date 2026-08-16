/**
 * Palace Gateway — entry point. Composition root: this is the only place where
 * concrete implementations are chosen and wired together.
 */

import type { ErrorResponse } from "@mempalace-bot/contract";
import { loadConfig } from "./config.ts";
import { openDatabase } from "./state/db.ts";
import { Registry } from "./access/registry.ts";
import { McpPalaceAdapter } from "./palace/mcpAdapter.ts";
import { buildServer } from "./server.ts";

async function main(): Promise<void> {
  const config = loadConfig();

  const db = openDatabase(config.statePath);
  const registry = new Registry(db);
  const palace = new McpPalaceAdapter({
    url: config.palaceUrl,
    authorization: config.palaceAuthorization,
  });

  const app = buildServer({
    registry,
    palace,
    token: config.token,
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
