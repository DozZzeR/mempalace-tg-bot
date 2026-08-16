import { beforeEach, describe, expect, test } from "vitest";
import { openDatabase, type Database } from "./state/db.ts";
import { Registry } from "./access/registry.ts";
import { AdminStore } from "./access/admin.ts";
import { FakePalace } from "./palace/fakePalace.ts";
import { buildServer } from "./server.ts";

const TOKEN = "t";
const SECRET = "a-secret-long-enough";
const BOSS = 1;
const ALICE = 111;

let db: Database;
let registry: Registry;
let admin: AdminStore;
let app: ReturnType<typeof buildServer>;

beforeEach(async () => {
  db = openDatabase(":memory:");
  registry = new Registry(db, [BOSS]);
  admin = new AdminStore({ db, registry, secret: SECRET, ttlMs: 60_000 });

  app = buildServer({
    registry,
    palace: new FakePalace({
      alpha: [],
      beta_wing: [],
      family: [],
      private_notes: [],
    }),
    token: TOKEN,
    admin,
  });

  await app.inject({
    method: "POST",
    url: "/admin/session",
    headers: as(BOSS),
    payload: { secret: SECRET },
  });
});

function as(userId: number) {
  return {
    authorization: `Bearer ${TOKEN}`,
    "x-telegram-user-id": String(userId),
  };
}

describe("choosing what to publish", () => {
  test("lists the palace's wings with a published flag", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/wings",
      headers: as(BOSS),
    });

    const wings = res.json().wings as Array<{ wing: string; published: boolean }>;
    expect(wings.map((w) => w.wing)).toContain("alpha");
    expect(wings.every((w) => !w.published)).toBe(true);
  });

  test("never offers a forbidden wing as a candidate", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/wings",
      headers: as(BOSS),
    });

    // Rejecting on publish is not enough: an admin should never be shown a
    // button that cannot work.
    const names = (res.json().wings as Array<{ wing: string }>).map((w) => w.wing);
    expect(names).not.toContain("family");
    expect(names).not.toContain("private_notes");
  });

  test("publishing makes the project visible to people", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/admin/projects",
      headers: as(BOSS),
      payload: { wing: "beta_wing", title: "Бета" },
    });
    expect(created.statusCode).toBe(201);

    registry.admit({ telegramUserId: ALICE });
    expect(registry.visibleTo(ALICE).map((p) => p.title)).toEqual(["Бета"]);
  });

  test("derives the project id from the wing", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/projects",
      headers: as(BOSS),
      payload: { wing: "beta_wing", title: "Бета" },
    });

    // Derived rather than asked for: two fields that must agree are one field
    // too many, and a mistyped id makes a project nobody can reach.
    expect(res.json().id).toBe("beta-wing");
  });

  test("refuses to publish a forbidden wing even by direct request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/projects",
      headers: as(BOSS),
      payload: { wing: "family", title: "Семья" },
    });

    expect(res.statusCode).toBe(403);
    expect(registry.published()).toEqual([]);
  });

  test("requires a title", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/projects",
      headers: as(BOSS),
      payload: { wing: "alpha", title: "  " },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("unpublishing", () => {
  beforeEach(async () => {
    await app.inject({
      method: "POST",
      url: "/admin/projects",
      headers: as(BOSS),
      payload: { wing: "alpha", title: "Альфа" },
    });
    registry.admit({ telegramUserId: ALICE });
    registry.restrictTo(ALICE, ["alpha"]);
  });

  test("removes it from what people see", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/projects/alpha",
      headers: as(BOSS),
    });

    expect(res.statusCode).toBe(204);
    expect(registry.published()).toEqual([]);
    expect(registry.visibleTo(ALICE)).toEqual([]);
  });

  test("clears the grants that pointed at it", async () => {
    await app.inject({
      method: "DELETE",
      url: "/admin/projects/alpha",
      headers: as(BOSS),
    });

    // Otherwise the rows outlive their subject and silently reappear as access
    // if the identifier is ever reused.
    const left = db
      .prepare(`SELECT COUNT(*) AS n FROM user_projects WHERE project_id = 'alpha'`)
      .get() as { n: number };
    expect(left.n).toBe(0);
  });

  test("a non-admin cannot publish anything", async () => {
    registry.admit({ telegramUserId: ALICE });
    const res = await app.inject({
      method: "POST",
      url: "/admin/projects",
      headers: as(ALICE),
      payload: { wing: "beta_wing", title: "x" },
    });
    expect(res.statusCode).toBe(404);
  });
});
