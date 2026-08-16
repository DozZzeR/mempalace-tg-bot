import { beforeEach, describe, expect, test } from "vitest";
import { openDatabase, type Database } from "./state/db.ts";
import { Registry } from "./access/registry.ts";
import { AdminStore } from "./access/admin.ts";
import { hashSecret } from "./access/secretHash.ts";
import { FakePalace } from "./palace/fakePalace.ts";
import { buildServer } from "./server.ts";

const TOKEN = "test-gateway-token";
const SECRET = "let-me-in-please";
const BOSS = 1;
const ALICE = 111;
const STRANGER = 999;

let db: Database;
let registry: Registry;
let admin: AdminStore;
let app: ReturnType<typeof buildServer>;

beforeEach(async () => {
  db = openDatabase(":memory:");
  // Admin-ness comes from configuration, not from a row.
  registry = new Registry(db, [BOSS]);
  // The store holds a hash, never the phrase.
  admin = new AdminStore({
    db,
    registry,
    secret: await hashSecret(SECRET),
    ttlMs: 60_000,
  });

  registry.publish({ id: "alpha", wing: "alpha", title: "Alpha" });
  registry.publish({ id: "beta", wing: "beta", title: "Beta" });
  registry.admit({ telegramUserId: ALICE, displayName: "Alice" });

  app = buildServer({
    registry,
    palace: new FakePalace({ alpha: [], beta: [] }),
    token: TOKEN,
    admin,
  });
});

function as(userId: number) {
  return {
    authorization: `Bearer ${TOKEN}`,
    "x-telegram-user-id": String(userId),
  };
}

async function openSession(userId = BOSS, secret = SECRET) {
  return app.inject({
    method: "POST",
    url: "/admin/session",
    headers: as(userId),
    payload: { secret },
  });
}

describe("asking for access", () => {
  test("a stranger may ask, and it grants nothing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/access-requests",
      headers: as(STRANGER),
      payload: { displayName: "Stranger" },
    });

    expect(res.statusCode).toBe(202);
    expect(registry.caller(STRANGER)).toBeUndefined();
    expect(admin.pending().map((r) => r.telegramUserId)).toEqual([STRANGER]);
  });

  test("a stranger still cannot read anything", async () => {
    await app.inject({
      method: "POST",
      url: "/access-requests",
      headers: as(STRANGER),
      payload: { displayName: "Stranger" },
    });

    const res = await app.inject({
      method: "GET",
      url: "/projects",
      headers: as(STRANGER),
    });
    expect(res.statusCode).toBe(403);
  });

  test("a denial is not undone by asking again", async () => {
    admin.requestAccess(STRANGER, "Stranger");
    admin.decide(STRANGER, false);
    admin.requestAccess(STRANGER, "Stranger");

    // Otherwise a denied person reappears in the queue on every attempt, and
    // the admin ends up re-deciding the same case forever.
    expect(admin.pending()).toEqual([]);
    expect(registry.caller(STRANGER)).toBeUndefined();
  });
});

describe("the admin session", () => {
  test("admin powers do not exist before a session is opened", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/state",
      headers: as(BOSS),
    });
    expect(res.statusCode).toBe(403);
  });

  test("a wrong secret opens nothing", async () => {
    const res = await openSession(BOSS, "wrong");
    expect(res.statusCode).toBe(403);
  });

  test("a non-admin cannot open one even with the right secret", async () => {
    const res = await openSession(ALICE, SECRET);
    expect(res.statusCode).toBe(403);
    expect(admin.hasSession(ALICE)).toBe(false);
  });

  test("a non-admin sees no admin surface at all", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/state",
      headers: as(ALICE),
    });
    // 404, not 403: the response should not confirm that an admin API exists.
    expect(res.statusCode).toBe(404);
  });

  test("the right secret opens a session and admin routes start working", async () => {
    expect((await openSession()).statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: "/admin/state",
      headers: as(BOSS),
    });
    expect(res.statusCode).toBe(200);
  });

  test("the configured owner is an admin without any database row", () => {
    // No admit() was called for BOSS. Locking the owner out of their own bot by
    // editing a table is not a state worth being able to reach.
    expect(registry.caller(BOSS)?.isAdmin).toBe(true);
    expect(registry.visibleTo(BOSS).map((p) => p.id)).toEqual(["alpha", "beta"]);
  });

  test("an admin cannot be restricted out of a project", () => {
    registry.admit({ telegramUserId: BOSS, displayName: "Boss" });
    registry.restrictTo(BOSS, []);

    // An admin with a restrictive row must not see less than the same admin
    // with no row at all.
    expect(registry.visibleTo(BOSS).map((p) => p.id)).toEqual(["alpha", "beta"]);
  });

  test("an admitted user cannot become an admin through the database", () => {
    db.prepare(`UPDATE users SET is_admin = 1 WHERE telegram_user_id = ?`).run(
      ALICE,
    );
    // The row is storage, not authority.
    expect(registry.caller(ALICE)?.isAdmin).toBe(false);
  });

  test("an expired session stops working", async () => {
    const shortLived = new AdminStore({
      db,
      registry,
      secret: await hashSecret(SECRET),
      ttlMs: -1,
    });
    const server = buildServer({
      registry,
      palace: new FakePalace(),
      token: TOKEN,
      admin: shortLived,
    });

    await server.inject({
      method: "POST",
      url: "/admin/session",
      headers: as(BOSS),
      payload: { secret: SECRET },
    });

    const res = await server.inject({
      method: "GET",
      url: "/admin/state",
      headers: as(BOSS),
    });
    expect(res.statusCode).toBe(403);
  });

  test("closing a session revokes the powers immediately", async () => {
    await openSession();
    await app.inject({
      method: "DELETE",
      url: "/admin/session",
      headers: as(BOSS),
    });

    const res = await app.inject({
      method: "GET",
      url: "/admin/state",
      headers: as(BOSS),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("deciding on a request", () => {
  beforeEach(async () => {
    admin.requestAccess(STRANGER, "Stranger");
    await openSession();
  });

  test("approving admits the person", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${STRANGER}`,
      headers: as(BOSS),
      payload: { approve: true },
    });

    expect(res.statusCode).toBe(204);
    expect(registry.caller(STRANGER)).toBeDefined();
    expect(admin.pending()).toEqual([]);
  });

  test("an approved person sees the whole registry by default", async () => {
    await app.inject({
      method: "POST",
      url: `/admin/requests/${STRANGER}`,
      headers: as(BOSS),
      payload: { approve: true },
    });

    expect(registry.visibleTo(STRANGER).map((p) => p.id)).toEqual([
      "alpha",
      "beta",
    ]);
  });

  test("denying admits nobody", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/admin/requests/${STRANGER}`,
      headers: as(BOSS),
      payload: { approve: false },
    });

    expect(res.statusCode).toBe(204);
    expect(registry.caller(STRANGER)).toBeUndefined();
  });
});

describe("choosing a user's projects", () => {
  beforeEach(async () => {
    await openSession();
  });

  test("restricting a user hides the rest", async () => {
    await app.inject({
      method: "PUT",
      url: `/admin/users/${ALICE}/projects`,
      headers: as(BOSS),
      payload: { projectIds: ["alpha"] },
    });

    expect(registry.visibleTo(ALICE).map((p) => p.id)).toEqual(["alpha"]);
  });

  test("an empty list means they see nothing, which is a valid choice", async () => {
    await app.inject({
      method: "PUT",
      url: `/admin/users/${ALICE}/projects`,
      headers: as(BOSS),
      payload: { projectIds: [] },
    });

    expect(registry.visibleTo(ALICE)).toEqual([]);
  });

  test("null returns them to the whole registry", async () => {
    await app.inject({
      method: "PUT",
      url: `/admin/users/${ALICE}/projects`,
      headers: as(BOSS),
      payload: { projectIds: ["alpha"] },
    });
    await app.inject({
      method: "PUT",
      url: `/admin/users/${ALICE}/projects`,
      headers: as(BOSS),
      payload: { projectIds: null },
    });

    expect(registry.visibleTo(ALICE).map((p) => p.id)).toEqual(["alpha", "beta"]);
  });

  test("an unknown id is dropped rather than raising a database error", () => {
    // The CLI calls restrictTo directly, so the filter has to live there and
    // not at one call site. This used to surface as FOREIGN KEY constraint
    // failed, half applied.
    expect(() => registry.restrictTo(ALICE, ["alpha", "never-published"])).not.toThrow();
    expect(registry.visibleTo(ALICE).map((p) => p.id)).toEqual(["alpha"]);
  });

  test("a project unpublished after being granted simply disappears", () => {
    registry.restrictTo(ALICE, ["alpha", "beta"]);
    admin.unpublish("beta");

    expect(registry.visibleTo(ALICE).map((p) => p.id)).toEqual(["alpha"]);
  });

  test("an unpublished project id cannot be granted", async () => {
    await app.inject({
      method: "PUT",
      url: `/admin/users/${ALICE}/projects`,
      headers: as(BOSS),
      payload: { projectIds: ["alpha", "forkids", "family"] },
    });

    // Grants are filtered against the registry, so a typo or a guess cannot
    // create access to something that was never published.
    expect(registry.visibleTo(ALICE).map((p) => p.id)).toEqual(["alpha"]);
  });
});
