/** Configuration comes from the environment only. Never from a file in the repo. */

export type GatewayConfig = {
  port: number;
  /** Shared secret the bot presents. The gateway trusts no unauthenticated caller. */
  token: string;
  statePath: string;
  palaceUrl: string;
  /**
   * Credential for MemPalace. Must belong to a profile that cannot reach
   * private or family wings — our own deny-list is then the second line of
   * defence rather than the only one.
   */
  palaceAuthorization: string;
};

class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new ConfigError(`${name} is not set — see .env.example`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

export function loadConfig(): GatewayConfig {
  const port = Number(optional("GATEWAY_PORT", "8787"));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new ConfigError(`GATEWAY_PORT is not a valid port: ${port}`);
  }

  return {
    port,
    token: required("GATEWAY_TOKEN"),
    statePath: optional("STATE_DB_PATH", "./data/state.sqlite"),
    palaceUrl: required("PALACE_URL"),
    palaceAuthorization: required("PALACE_AUTHORIZATION"),
  };
}
