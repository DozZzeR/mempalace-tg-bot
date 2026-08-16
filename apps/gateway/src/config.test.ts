import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadConfig } from "./config.ts";

const PALACE_KEYS = [
  "PALACE_COMMAND",
  "PALACE_ARGS",
  "PALACE_ENV",
  "PALACE_CWD",
  "PALACE_URL",
  "PALACE_AUTHORIZATION",
  "GATEWAY_TOKEN",
  "GATEWAY_PORT",
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of PALACE_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  process.env["GATEWAY_TOKEN"] = "t";
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("palace transport selection", () => {
  test("prefers stdio when a command is configured", () => {
    process.env["PALACE_COMMAND"] = "mempalace-mcp";
    process.env["PALACE_ARGS"] = "--profile common";

    const palace = loadConfig().palace;

    expect(palace.kind).toBe("stdio");
    if (palace.kind !== "stdio") return;
    expect(palace.command).toBe("mempalace-mcp");
    expect(palace.args).toEqual(["--profile", "common"]);
  });

  test("passes only the named variables to the child process", () => {
    process.env["PALACE_COMMAND"] = "mempalace-mcp";
    process.env["PALACE_ENV"] = "MEMPALACE_ACCESS_PROFILE=common,FOO=bar";

    const palace = loadConfig().palace;
    if (palace.kind !== "stdio") throw new Error("expected stdio");

    // Inheriting the gateway's environment would hand the child the Telegram
    // token and the shared secret. The child gets what it was given, no more.
    expect(palace.env).toEqual({
      MEMPALACE_ACCESS_PROFILE: "common",
      FOO: "bar",
    });
  });

  test("falls back to http and then demands a credential", () => {
    process.env["PALACE_URL"] = "https://palace.test/mcp";
    expect(() => loadConfig()).toThrow(/PALACE_AUTHORIZATION/);
  });

  test("accepts a complete http configuration", () => {
    process.env["PALACE_URL"] = "https://palace.test/mcp";
    process.env["PALACE_AUTHORIZATION"] = "Bearer x";

    const palace = loadConfig().palace;
    expect(palace).toEqual({
      kind: "http",
      url: "https://palace.test/mcp",
      authorization: "Bearer x",
    });
  });

  test("rejects a port that is not a port", () => {
    process.env["PALACE_COMMAND"] = "x";
    process.env["GATEWAY_PORT"] = "99999";
    expect(() => loadConfig()).toThrow(/GATEWAY_PORT/);
  });
});
