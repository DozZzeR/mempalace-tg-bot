/** Configuration comes from the environment only. Never from a file in the repo. */

export type PalaceTransport =
  | { kind: "stdio"; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { kind: "http"; url: string; authorization: string };

export type GatewayConfig = {
  port: number;
  /** Shared secret the bot presents. The gateway trusts no unauthenticated caller. */
  token: string;
  statePath: string;
  palace: PalaceTransport;
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

/**
 * Chooses the palace transport. stdio wins when a command is configured,
 * because a colocated child process needs no port and no credential; HTTP is
 * the fallback for when the gateway and the palace live on different hosts.
 */
function loadPalace(): PalaceTransport {
  const command = process.env["PALACE_COMMAND"];

  if (command !== undefined && command !== "") {
    const cwd = process.env["PALACE_CWD"];
    return {
      kind: "stdio",
      command,
      args: splitArgs(optional("PALACE_ARGS", "")),
      // Only what is named here reaches the child. The gateway's own
      // environment holds the Telegram token and the shared secret, and none of
      // that is the palace's business.
      env: parseEnv(optional("PALACE_ENV", "")),
      ...(cwd === undefined || cwd === "" ? {} : { cwd }),
    };
  }

  return {
    kind: "http",
    url: required("PALACE_URL"),
    authorization: required("PALACE_AUTHORIZATION"),
  };
}

/** `--flag value --other` → ["--flag", "value", "--other"]. */
function splitArgs(raw: string): string[] {
  return raw.split(/\s+/).filter((part) => part !== "");
}

/** `A=1,B=2` → { A: "1", B: "2" }. */
function parseEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (trimmed === "") continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    result[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return result;
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
    palace: loadPalace(),
  };
}
