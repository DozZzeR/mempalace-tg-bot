import { beforeEach, describe, expect, test } from "vitest";
import { openDatabase, type Database } from "./state/db.ts";
import { Registry } from "./access/registry.ts";
import { ForbiddenWingError } from "./access/forbidden.ts";
import { FakePalace } from "./palace/fakePalace.ts";
import { buildServer } from "./server.ts";

const TOKEN = "test-gateway-token";

const ALICE = 111;
const BOB = 222;
const STRANGER = 999;

let db: Database;
let registry: Registry;
let palace: FakePalace;
let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  db = openDatabase(":memory:");
  registry = new Registry(db);
  palace = new FakePalace({
    alpha: [{ text: "alpha decided to ship", key: "d1" }],
    beta: [{ text: "beta decided to wait", key: "d2" }],
  });

  registry.publish({ id: "alpha", wing: "alpha", title: "Alpha" });
  registry.publish({ id: "beta", wing: "beta", title: "Beta" });

  registry.admit({ telegramUserId: ALICE, displayName: "Alice" });
  registry.admit({ telegramUserId: BOB, displayName: "Bob" });
  registry.restrictTo(BOB, ["alpha"]);

  app = buildServer({ registry, palace, token: TOKEN });
});

function as(userId: number) {
  return {
    authorization: `Bearer ${TOKEN}`,
    "x-telegram-user-id": String(userId),
  };
}

describe("cut 1 — allowlist", () => {
  test("rejects a caller without the shared secret", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects",
      headers: { "x-telegram-user-id": String(ALICE) },
    });
    expect(res.statusCode).toBe(401);
  });

  test("refuses a person who is not admitted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects",
      headers: as(STRANGER),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("cut 3 — per-user project set", () => {
  test("an unrestricted user sees the whole registry", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects",
      headers: as(ALICE),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().projects.map((p: { id: string }) => p.id)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  test("a restricted user sees only what was granted", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects",
      headers: as(BOB),
    });
    expect(res.json().projects.map((p: { id: string }) => p.id)).toEqual([
      "alpha",
    ]);
  });

  test("search into an ungranted project yields nothing and reads as absent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects/beta/search?q=decided",
      headers: as(BOB),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not found", code: "not_found" });
  });

  test("an ungranted project is never even asked about", async () => {
    await app.inject({
      method: "GET",
      url: "/projects/beta/search?q=decided",
      headers: as(BOB),
    });

    // The strongest form of the guarantee: the check runs before any palace
    // access, so nothing can leak through a partial result or an error path.
    expect(palace.searched).toEqual([]);
  });

  test("a drawer in an ungranted project cannot be fetched by key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects/beta/drawers/d2",
      headers: as(BOB),
    });
    expect(res.statusCode).toBe(404);
  });

  test("an ungranted project is indistinguishable from one that does not exist", async () => {
    const ungranted = await app.inject({
      method: "GET",
      url: "/projects/beta/search?q=decided",
      headers: as(BOB),
    });
    const nonexistent = await app.inject({
      method: "GET",
      url: "/projects/does-not-exist/search?q=decided",
      headers: as(BOB),
    });

    expect(ungranted.statusCode).toBe(nonexistent.statusCode);
    expect(ungranted.json()).toEqual(nonexistent.json());
  });

  test("a granted project does return its fragments", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects/alpha/search?q=decided",
      headers: as(BOB),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().fragments).toHaveLength(1);
    expect(res.json().fragments[0].text).toBe("alpha decided to ship");
  });
});

describe("cut 2 — registry containment", () => {
  test("a wing in the palace but not in the registry never surfaces", async () => {
    palace = new FakePalace({ secret_project: [{ text: "unpublished" }] });
    app = buildServer({ registry, palace, token: TOKEN });

    const list = await app.inject({
      method: "GET",
      url: "/projects",
      headers: as(ALICE),
    });
    expect(
      list.json().projects.map((p: { id: string }) => p.id),
    ).not.toContain("secret_project");

    const search = await app.inject({
      method: "GET",
      url: "/projects/secret_project/search?q=unpublished",
      headers: as(ALICE),
    });
    expect(search.statusCode).toBe(404);
    expect(palace.searched).toEqual([]);
  });

  test("a forbidden wing cannot be published", () => {
    expect(() =>
      registry.publish({ id: "fam", wing: "family", title: "Family" }),
    ).toThrow(ForbiddenWingError);
  });

  test("a forbidden wing stays invisible even when forced into the table", async () => {
    // Bypassing publish() entirely — this is the misconfiguration case: someone
    // edits the database by hand. The gateway must still refuse.
    db.prepare(
      `INSERT INTO projects (id, wing, title, description, created_at)
       VALUES ('fam', 'family', 'Family', NULL, '2026-08-16T00:00:00.000Z')`,
    ).run();

    const list = await app.inject({
      method: "GET",
      url: "/projects",
      headers: as(ALICE),
    });
    expect(list.json().projects.map((p: { id: string }) => p.id)).toEqual([
      "alpha",
      "beta",
    ]);

    const search = await app.inject({
      method: "GET",
      url: "/projects/fam/search?q=anything",
      headers: as(ALICE),
    });
    expect(search.statusCode).toBe(404);
    expect(palace.searched).toEqual([]);
  });
});
