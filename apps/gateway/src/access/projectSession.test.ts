import { beforeEach, describe, expect, test } from "vitest";
import { openDatabase, type Database } from "../state/db.ts";
import { Registry } from "./registry.ts";
import { FakePalace } from "../palace/fakePalace.ts";
import { ProjectSession } from "./projectSession.ts";

const ALICE = 111;
const BOB = 222;

let db: Database;
let registry: Registry;
let palace: FakePalace;

beforeEach(() => {
  db = openDatabase(":memory:");
  registry = new Registry(db);
  palace = new FakePalace({
    alpha: [{ text: "alpha secret", key: "a1" }],
    beta: [{ text: "beta secret", key: "b1" }],
  });

  registry.publish({ id: "alpha", wing: "alpha", title: "Alpha" });
  registry.publish({ id: "beta", wing: "beta", title: "Beta" });
  registry.admit({ telegramUserId: ALICE });
  registry.admit({ telegramUserId: BOB });
  registry.restrictTo(BOB, ["alpha"]);
});

describe("project session", () => {
  test("opens for a project the caller may see", () => {
    expect(ProjectSession.open(registry, palace, BOB, "alpha")).toBeDefined();
  });

  test("refuses to open for a project outside the caller's set", () => {
    expect(ProjectSession.open(registry, palace, BOB, "beta")).toBeUndefined();
  });

  test("refuses identically for a project that does not exist", () => {
    const ungranted = ProjectSession.open(registry, palace, BOB, "beta");
    const missing = ProjectSession.open(registry, palace, BOB, "nope");
    expect(ungranted).toBe(missing);
  });

  test("searches only inside the project it was opened for", async () => {
    const session = ProjectSession.open(registry, palace, ALICE, "alpha");
    await session?.search("secret");

    expect(palace.searched).toEqual([{ wing: "alpha", query: "secret" }]);
  });

  test("two sessions never cross", async () => {
    const a = ProjectSession.open(registry, palace, ALICE, "alpha");
    const b = ProjectSession.open(registry, palace, ALICE, "beta");

    expect(await a?.search("secret")).toEqual([
      expect.objectContaining({ text: "alpha secret" }),
    ]);
    expect(await b?.search("secret")).toEqual([
      expect.objectContaining({ text: "beta secret" }),
    ]);
  });

  test("reading by key cannot reach another project", async () => {
    const session = ProjectSession.open(registry, palace, ALICE, "alpha");

    // b1 exists in the palace, but not in this session's project. A guessed or
    // pasted key must not become a way across.
    expect(await session?.read("b1")).toBeUndefined();
    expect(await session?.read("a1")).toBeDefined();
  });

  test("exposes no way to name a location", () => {
    const session = ProjectSession.open(registry, palace, ALICE, "alpha");
    if (session === undefined) throw new Error("expected a session");

    // The safety property is structural: anything handed this object — a
    // reasoning layer included — has no vocabulary for "a different project".
    // search takes a query and a limit; read takes a key. Nothing takes a wing.
    expect(session.search.length).toBe(1);
    expect(session.read.length).toBe(1);

    // And the palace adapter must not be reachable through the object either.
    // TypeScript's `private` is erased at runtime; only #fields actually hide.
    expect(Object.keys(session)).toEqual(["projectId"]);
    expect(JSON.parse(JSON.stringify(session))).toEqual({
      projectId: "alpha",
    });
  });
});
