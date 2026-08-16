import { describe, expect, test } from "vitest";
import { GatewayError, HttpGatewayClient } from "./client.ts";

type FetchArgs = Parameters<typeof globalThis.fetch>;
type FetchInit = FetchArgs[1];

function clientWith(
  responder: (url: string, init: FetchInit) => Response | Promise<Response>,
) {
  const calls: Array<{ url: string; init: FetchInit }> = [];
  const client = new HttpGatewayClient({
    baseUrl: "http://gateway.test",
    token: "secret",
    fetch: (async (input: FetchArgs[0], init: FetchInit) => {
      const url = String(input);
      calls.push({ url, init });
      return responder(url, init);
    }) as typeof globalThis.fetch,
  });
  return { client, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("gateway client", () => {
  test("presents the shared secret and the caller identity", async () => {
    const { client, calls } = clientWith(() => json({ projects: [] }));
    await client.projects(42);

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer secret");
    expect(headers["x-telegram-user-id"]).toBe("42");
  });

  test("never puts a wing on the wire", async () => {
    const { client, calls } = clientWith(() =>
      json({ projectId: "alpha", query: "q", fragments: [], synthesized: false }),
    );
    await client.search(42, "alpha", "какие решения");

    // The bot addresses a project. If a wing ever appears in a request the bot
    // built, a rule has leaked out of the gateway.
    expect(calls[0]?.url).toContain("/projects/alpha/search");
    expect(calls[0]?.url).not.toMatch(/wing/i);
  });

  test("escapes the query rather than splicing it into the path", async () => {
    const { client, calls } = clientWith(() =>
      json({ projectId: "a", query: "q", fragments: [], synthesized: false }),
    );
    await client.search(1, "a/../b", "x&y=z");

    expect(calls[0]?.url).toContain("a%2F..%2Fb");
    expect(calls[0]?.url).toContain("x%26y%3Dz");
  });

  test("reads 403 as a permission problem", async () => {
    const { client } = clientWith(() => json({}, 403));
    await expect(client.projects(1)).rejects.toMatchObject({
      kind: "forbidden",
    });
  });

  test("reads 404 as a missing project", async () => {
    const { client } = clientWith(() => json({}, 404));
    await expect(client.search(1, "nope", "q")).rejects.toMatchObject({
      kind: "not_found",
    });
  });

  test("reads a transport failure as unavailable, not as a denial", async () => {
    const { client } = clientWith(() => {
      throw new Error("ECONNREFUSED");
    });

    // Distinguishing these matters: telling someone they lack access when the
    // gateway is merely down sends them to an administrator for nothing.
    const error = await client.projects(1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect(error).toMatchObject({ kind: "unavailable" });
  });

  test("reads a server error as unavailable", async () => {
    const { client } = clientWith(() => json({}, 500));
    await expect(client.projects(1)).rejects.toMatchObject({
      kind: "unavailable",
    });
  });
});
