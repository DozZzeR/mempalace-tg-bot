/**
 * Local development entry point: the real gateway, wired to a fake palace.
 *
 * Deliberately a separate file rather than a fallback inside index.ts. A
 * production entry that quietly runs on fake data when a credential is missing
 * is the kind of convenience that eventually ships. This one has to be asked
 * for by name.
 *
 *   node apps/gateway/src/dev/devServer.ts
 *
 * Seeds an in-memory registry from DEV_SEED_USER (a Telegram user id) so there
 * is something to look at.
 */

import { openDatabase } from "../state/db.ts";
import { Registry } from "../access/registry.ts";
import { FakePalace } from "../palace/fakePalace.ts";
import { buildServer } from "../server.ts";

const PORT = Number(process.env["GATEWAY_PORT"] ?? "8787");
const TOKEN = process.env["GATEWAY_TOKEN"] ?? "dev-token";
const SEED_USER = Number(process.env["DEV_SEED_USER"] ?? "1");

const palace = new FakePalace({
  demo_wing: [
    {
      key: "d1",
      text: "Решение: релиз откладываем до понедельника, потому что не готова миграция.",
      hall: "decision",
      room: "decisions",
    },
    {
      key: "d2",
      text: "Договорились: релизим по вторникам, не по пятницам.",
      hall: "decision",
      room: "conventions",
    },
  ],
  other_wing: [
    { key: "x1", text: "Релиз другого проекта — сюда попадать не должен.", hall: "decision", room: "decisions" },
  ],
});

const db = openDatabase(":memory:");
const registry = new Registry(db, [SEED_USER]);

registry.publish({
  id: "demo",
  wing: "demo_wing",
  title: "Демо-проект",
  description: "Фейковые данные для локальной проверки.",
});
registry.publish({ id: "other", wing: "other_wing", title: "Другой проект" });
registry.admit({ telegramUserId: SEED_USER, displayName: "dev" });

const app = buildServer({ registry, palace, token: TOKEN, logger: true });

await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`dev gateway on :${PORT}, seeded user ${SEED_USER}, FAKE palace`);
