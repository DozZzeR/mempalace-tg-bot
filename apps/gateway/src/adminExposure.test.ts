import { beforeEach, describe, expect, test } from "vitest";
import { openDatabase, type Database } from "./state/db.ts";
import { Registry } from "./access/registry.ts";
import { AdminStore } from "./access/admin.ts";
import { hashSecret } from "./access/secretHash.ts";
import { FakePalace } from "./palace/fakePalace.ts";
import { buildServer } from "./server.ts";

/**
 * The admin surface should not announce itself. Someone who is not an admin
 * ought to be unable to tell, from any response, that one exists — which is why
 * admin routes answer 404 to them rather than 403.
 */

const TOKEN = "t";
const PHRASE = "три весёлых бобра чинят плотину";
const BOSS = 1;
const ALICE = 111;
const STRANGER = 999;

let db: Database;
let registry: Registry;
let app: ReturnType<typeof buildServer>;

beforeEach(async () => {
  db = openDatabase(":memory:");
  registry = new Registry(db, [BOSS]);
  registry.publish({ id: "alpha", wing: "alpha", title: "Alpha" });
  registry.admit({ telegramUserId: ALICE, displayName: "Alice" });

  app = buildServer({
    registry,
    palace: new FakePalace({ alpha: [] }),
    token: TOKEN,
    admin: new AdminStore({
      db,
      registry,
      secret: await hashSecret(PHRASE),
      ttlMs: 60_000,
    }),
  });
});

function as(userId: number) {
  return {
    authorization: `Bearer ${TOKEN}`,
    "x-telegram-user-id": String(userId),
  };
}

const ADMIN_ROUTES = [
  { method: "GET" as const, url: "/admin/state" },
  { method: "GET" as const, url: "/admin/wings" },
  { method: "POST" as const, url: "/admin/projects" },
  { method: "DELETE" as const, url: "/admin/projects/alpha" },
  { method: "POST" as const, url: "/admin/requests/999" },
  { method: "PUT" as const, url: "/admin/users/111/projects" },
];

describe("an admitted non-admin", () => {
  test("gets 404 from every admin route, never 403", async () => {
    for (const route of ADMIN_ROUTES) {
      const res = await app.inject({ ...route, headers: as(ALICE), payload: {} });
      // 403 would confirm the route exists and is merely locked.
      expect(`${route.method} ${route.url} -> ${res.statusCode}`).toBe(
        `${route.method} ${route.url} -> 404`,
      );
    }
  });

  test("cannot open a session even with the correct phrase", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/session",
      headers: as(ALICE),
      payload: { secret: PHRASE },
    });

    // The phrase is not the authority; ADMIN_IDS is.
    expect(res.statusCode).toBe(403);
  });

  test("is not told there are people waiting", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects",
      headers: as(ALICE),
    });

    expect(res.json().isAdmin).toBe(false);
    expect(res.json().pendingRequests).toBeUndefined();
  });
});

describe("a stranger", () => {
  test("is stopped by the allowlist before any admin route is reached", async () => {
    for (const route of [...ADMIN_ROUTES, { method: "POST" as const, url: "/admin/session" }]) {
      const res = await app.inject({
        ...route,
        headers: as(STRANGER),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe("the admin", () => {
  test("still gets in with the right phrase", async () => {
    const opened = await app.inject({
      method: "POST",
      url: "/admin/session",
      headers: as(BOSS),
      payload: { secret: PHRASE },
    });
    expect(opened.statusCode).toBe(200);

    const state = await app.inject({
      method: "GET",
      url: "/admin/state",
      headers: as(BOSS),
    });
    expect(state.statusCode).toBe(200);
  });

  test("is refused with the wrong phrase, indistinguishably from a non-admin", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/session",
      headers: as(BOSS),
      payload: { secret: "не та фраза" },
    });
    expect(res.statusCode).toBe(403);
  });
});
