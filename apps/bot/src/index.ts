/**
 * MemPalace Bot — entry point. Composition root: the only place concrete
 * implementations are chosen and wired.
 */

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
  void bot.start();
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
