import { looksLikeHash } from "./access/secretHash.ts";

/** Configuration comes from the environment only. Never from a file in the repo. */

export type PalaceTransport =
  | { kind: "stdio"; command: string; args: string[]; env: Record<string, string>; cwd?: string }
  | { kind: "http"; url: string; authorization: string };

export type ModelConfig = {
  model: string;
  timeoutMs: number;
  projectRoot: string;
  tmpDirectory: string;
  maxConcurrency: number;
  command: string;
  retries: number;
};

export type GatewayConfig = {
  port: number;
  /** Shared secret the bot presents. The gateway trusts no unauthenticated caller. */
  token: string;
  statePath: string;
  palace: PalaceTransport;
  /**
   * Absent means no reasoning layer: search runs on the words the person typed
   * and no prose is composed. The bot degrades rather than fails.
   */
  model: ModelConfig | undefined;
  /**
   * Absent means no admin surface exists at all — not even a locked one. Set
   * ADMIN_SECRET to enable it.
   */
  admin: { secret: string; ttlMs: number } | undefined;
  /**
   * Who the admins are. Configuration, not state: nothing reachable at runtime
   * can promote an account, and a fresh database still has an owner.
   */
  adminIds: number[];
  limits: { search: RateRule; note: RateRule };
};

type RateRule = { capacity: number; refillPerMinute: number };

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

/**
 * The reasoning layer is opt-in. MODEL_ENABLED=true turns it on; anything else
 * leaves the bot running verbatim search. Making it explicit rather than
 * inferring it from a stray variable means a half-configured box does not
 * quietly start spending Codex time.
 */
function loadModel(): ModelConfig | undefined {
  if (optional("MODEL_ENABLED", "false").toLowerCase() !== "true") {
    return undefined;
  }

  const timeoutMs = Number(optional("MODEL_TIMEOUT_MS", "120000"));
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`MODEL_TIMEOUT_MS is not valid: ${timeoutMs}`);
  }

  // Defaults deliberately point outside the repository. Codex walks UP from its
  // working directory looking for AGENTS.md and .agents/skills, so any path
  // beneath the repo root pulls our coding-agent instructions into the context
  // of the model that answers people — measured at ~1200 extra tokens of
  // exactly the wrong instructions. A sibling directory is fine; a descendant
  // is not.
  return {
    model: optional("MODEL_NAME", "gpt-5.5"),
    timeoutMs,
    projectRoot: optional("MODEL_PROJECT_ROOT", "../model"),
    tmpDirectory: optional("MODEL_TMP_DIR", "../model/tmp"),
    maxConcurrency: Number(optional("MODEL_MAX_CONCURRENCY", "1")) || 1,
    // Same lesson as the Node pin: a bare name resolves against whatever PATH
    // the supervisor happened to have.
    command: optional("MODEL_COMMAND", "codex"),
    retries: Number(optional("MODEL_RETRIES", "1")) || 0,
  };
}

/** `ADMIN_IDS=331673208,42` — Telegram user ids, comma separated. */
function loadAdminIds(): number[] {
  const raw = optional("ADMIN_IDS", "");
  const ids: number[] = [];

  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const id = Number(trimmed);
    // A typo here would silently produce a bot with no administrator, which
    // only shows up much later as "the secret does not work".
    if (!Number.isInteger(id) || id <= 0) {
      throw new ConfigError(`ADMIN_IDS contains a value that is not a Telegram id: ${trimmed}`);
    }
    ids.push(id);
  }
  return ids;
}

function loadAdmin(): { secret: string; ttlMs: number } | undefined {
  // A plaintext secret left over from an earlier setup is an error, not
  // something to ignore quietly: ignoring it would leave someone believing they
  // are protected by a value that does nothing.
  if (process.env["ADMIN_SECRET"] !== undefined && process.env["ADMIN_SECRET"] !== "") {
    throw new ConfigError(
      "ADMIN_SECRET is no longer used. Generate a hash with `npm run admin -- hash` " +
        "and set ADMIN_SECRET_HASH instead, then remove ADMIN_SECRET.",
    );
  }

  const hash = process.env["ADMIN_SECRET_HASH"];
  if (hash === undefined || hash === "") return undefined;

  if (!looksLikeHash(hash)) {
    throw new ConfigError(
      "ADMIN_SECRET_HASH is not a complete hash. It must be the whole line from " +
        "`npm run admin -- hash`, starting with scrypt: and about 100 characters " +
        "long — a value cut short while copying would otherwise refuse the right " +
        "phrase with no explanation.",
    );
  }

  // Short enough that a forgotten open session closes itself, long enough to
  // work through a queue of requests without re-entering the phrase.
  const ttlMs = Number(optional("ADMIN_SESSION_TTL_MS", "900000"));
  if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
    throw new ConfigError(`ADMIN_SESSION_TTL_MS is not valid: ${ttlMs}`);
  }
  return { secret: hash, ttlMs };
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
    model: loadModel(),
    admin: loadAdmin(),
    adminIds: loadAdminIds(),
    limits: {
      // A search costs a model run of half a minute or so; six in reserve with
      // three returning a minute is generous for a person and useless for a
      // loop.
      search: {
        capacity: Number(optional("SEARCH_BURST", "6")),
        refillPerMinute: Number(optional("SEARCH_PER_MINUTE", "3")),
      },
      note: {
        capacity: Number(optional("NOTE_BURST", "10")),
        refillPerMinute: Number(optional("NOTE_PER_MINUTE", "5")),
      },
    },
  };
}
