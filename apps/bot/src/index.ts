/**
 * MemPalace Bot — entry point.
 *
 * M0: it starts, reads its configuration, and answers /start. Project buttons
 * arrive in M2, once the gateway can actually list projects. The bot holds no
 * access rules and never sees a wing name — it works with project identifiers
 * the gateway issues.
 */

import { Bot } from "grammy";
import { loadConfig } from "./config.ts";

function main(): void {
  const config = loadConfig();
  const bot = new Bot(config.telegramToken);

  bot.command("start", async (ctx) => {
    await ctx.reply("Пока пусто. Кнопки проектов появятся на этапе M2.");
  });

  bot.catch((err) => {
    console.error("bot error:", err.message);
  });

  console.log(`bot starting, gateway at ${config.gatewayUrl}`);
  void bot.start();
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
