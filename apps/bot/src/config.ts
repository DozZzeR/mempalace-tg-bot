/** Configuration comes from the environment only. Never from a file in the repo. */

export type BotConfig = {
  telegramToken: string;
  /** The bot's public handle or t.me link. Display only — never an auth input. */
  botHandle: string;
  gatewayUrl: string;
  gatewayToken: string;
};

class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new ConfigError(`${name} is not set — see .env.example`);
  }
  return value;
}

export function loadConfig(): BotConfig {
  return {
    telegramToken: required("TELEGRAM_BOT_TOKEN"),
    botHandle: process.env["TELEGRAM_BOT"] ?? "",
    gatewayUrl: process.env["GATEWAY_URL"] || "http://127.0.0.1:8787",
    gatewayToken: required("GATEWAY_TOKEN"),
  };
}
