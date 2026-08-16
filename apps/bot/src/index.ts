/**
 * MemPalace Bot — entry point. Composition root: the only place concrete
 * implementations are chosen and wired.
 */

import { run } from "@grammyjs/runner";
import { loadConfig } from "./config.ts";
import { HttpGatewayClient } from "./gateway/client.ts";
import { buildBot } from "./bot.ts";

function main(): void {
  const config = loadConfig();

  const gateway = new HttpGatewayClient({
    baseUrl: config.gatewayUrl,
    token: config.gatewayToken,
  });

  const bot = buildBot({ token: config.telegramToken, gateway });

  const label = config.botHandle === "" ? "bot" : config.botHandle;
  console.log(`${label} starting, gateway at ${config.gatewayUrl}`);

  // run() rather than bot.start(): the built-in poller handles updates one at a
  // time, so a single half-minute search would freeze the bot for everyone.
  // Ordering within a chat is preserved by sequentialize in bot.ts.
  const runner = run(bot);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      // Let in-flight updates finish. A deploy mid-answer should not drop
      // someone's question on the floor.
      void runner.stop();
    });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
