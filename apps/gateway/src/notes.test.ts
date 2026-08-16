import { beforeEach, describe, expect, test } from "vitest";
import { openDatabase, type Database } from "./state/db.ts";
import { Registry } from "./access/registry.ts";
import { FakePalace } from "./palace/fakePalace.ts";
import { parseNote } from "./palace/noteRecord.ts";
import { buildServer } from "./server.ts";

const TOKEN = "test-gateway-token";
const ALICE = 111;
const BOB = 222;

let db: Database;
let registry: Registry;
let palace: FakePalace;
let app: ReturnType<typeof buildServer>;

beforeEach(() => {
  db = openDatabase(":memory:");
  registry = new Registry(db);
  palace = new FakePalace({ alpha: [], beta: [] });

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

function post(projectId: string, body: unknown, userId = ALICE) {
  return app.inject({
    method: "POST",
    url: `/projects/${projectId}/notes`,
    headers: as(userId),
    payload: body as object,
  });
}

describe("the write lands at the constant key", () => {
  test("stores a note under wing/human/notes", async () => {
    const res = await post("alpha", { text: "мысль", kind: "thought" });

    expect(res.statusCode).toBe(201);
    expect(palace.writes).toHaveLength(1);
    expect(palace.writes[0]).toMatchObject({
      wing: "alpha",
      hall: "human",
      room: "notes",
    });
  });

  test("uses the same hall and room for a different project", async () => {
    await post("alpha", { text: "a", kind: "thought" });
    await post("beta", { text: "b", kind: "thought" });

    const [first, second] = palace.writes;
    expect(first?.hall).toBe(second?.hall);
    expect(first?.room).toBe(second?.room);
    expect(first?.wing).not.toBe(second?.wing);
  });
});

describe("write-target integrity", () => {
  // Each of these asserts on the RECORDED WRITE, not on the status code. A 201
  // with the note in the wrong room is exactly the failure being hunted.

  test("an explicit wing in the body does not move the write", async () => {
    await post("alpha", { text: "x", kind: "thought", wing: "beta" });
    expect(palace.writes[0]?.wing).toBe("alpha");
  });

  test("an explicit hall in the body does not move the write", async () => {
    await post("alpha", { text: "x", kind: "thought", hall: "decision" });
    expect(palace.writes[0]?.hall).toBe("human");
  });

  test("an explicit room in the body does not move the write", async () => {
    await post("alpha", { text: "x", kind: "thought", room: "decisions" });
    expect(palace.writes[0]?.room).toBe("notes");
  });

  test("a whole address object in the body does not move the write", async () => {
    await post("alpha", {
      text: "x",
      kind: "thought",
      address: { wing: "family", hall: "decision", room: "secrets" },
      target: { wing: "family" },
    });

    expect(palace.writes[0]).toMatchObject({
      wing: "alpha",
      hall: "human",
      room: "notes",
    });
  });

  test("path traversal cannot escape the caller's project set", async () => {
    // The path normalises to /projects/beta/notes before routing, so what this
    // really asserts is that the permission check runs on the resolved project
    // rather than on the string the caller sent. Bob may not see beta.
    const res = await post("alpha/../beta", { text: "x", kind: "thought" }, BOB);

    expect(res.statusCode).toBe(404);
    expect(palace.writes).toEqual([]);
  });

  test("writing into an ungranted project is refused before the palace is touched", async () => {
    const res = await post("beta", { text: "x", kind: "thought" }, BOB);

    expect(res.statusCode).toBe(404);
    expect(palace.writes).toEqual([]);
  });

  test("a forbidden wing forced into the registry still cannot be written to", async () => {
    db.prepare(
      `INSERT INTO projects (id, wing, title, description, created_at)
       VALUES ('fam', 'family', 'Family', NULL, '2026-08-16T00:00:00.000Z')`,
    ).run();

    const res = await post("fam", { text: "x", kind: "thought" });

    expect(res.statusCode).toBe(404);
    expect(palace.writes).toEqual([]);
  });
});

describe("authorship is the server's to decide", () => {
  test("records the caller the registry resolved", async () => {
    await post("alpha", { text: "x", kind: "thought" });

    expect(palace.writes[0]?.content).toContain("author: Alice");
    expect(palace.writes[0]?.content).toContain(`author_id: ${ALICE}`);
  });

  test("an author supplied in the body is ignored", async () => {
    await post("alpha", {
      text: "x",
      kind: "thought",
      authorId: 999,
      authorName: "Кто-то другой",
    });

    const content = palace.writes[0]?.content ?? "";
    expect(content).toContain(`author_id: ${ALICE}`);
    expect(content).not.toContain("999");
    expect(content).not.toContain("Кто-то другой");
  });

  test("a newline in a display name cannot forge header fields", async () => {
    registry.admit({
      telegramUserId: 333,
      displayName: "Eve\nauthor_id: 111",
    });
    await post("alpha", { text: "x", kind: "thought" }, 333);

    const content = palace.writes[0]?.content ?? "";

    // The property that matters is what parses back, not whether the digits
    // appear somewhere. Header fields are read per line, and the newline was
    // flattened, so the injected text stays inside the author value.
    expect(parseNote(content, "k").authorId).toBe(333);
    expect(content.split("\n").some((line) => line === "author_id: 111")).toBe(
      false,
    );
  });
});

describe("note validation", () => {
  test("refuses an unknown kind", async () => {
    const res = await post("alpha", { text: "x", kind: "instruction" });
    expect(res.statusCode).toBe(400);
    expect(palace.writes).toEqual([]);
  });

  test("refuses empty text", async () => {
    const res = await post("alpha", { text: "   ", kind: "thought" });
    expect(res.statusCode).toBe(400);
  });

  test("refuses text beyond the limit", async () => {
    const res = await post("alpha", { text: "x".repeat(4001), kind: "thought" });
    expect(res.statusCode).toBe(400);
  });

  test("keeps an addressee only on a message", async () => {
    await post("alpha", { text: "привет", kind: "message", to: 555 });
    await post("alpha", { text: "мысль", kind: "thought", to: 555 });

    expect(palace.writes[0]?.content).toContain("to: 555");
    expect(palace.writes[1]?.content).not.toContain("to: 555");
  });
});

describe("reading the room back", () => {
  test("returns what was written, newest first", async () => {
    await post("alpha", { text: "первая", kind: "thought" });
    await post("alpha", { text: "вторая", kind: "plan" });

    const res = await app.inject({
      method: "GET",
      url: "/projects/alpha/notes",
      headers: as(ALICE),
    });

    const notes = res.json().notes as Array<Record<string, unknown>>;
    expect(notes.map((n) => n["text"])).toEqual(["вторая", "первая"]);
    expect(notes[0]).toMatchObject({ kind: "plan", authorName: "Alice" });
  });

  test("does not show another project's room", async () => {
    await post("beta", { text: "чужое", kind: "thought" });

    const res = await app.inject({
      method: "GET",
      url: "/projects/alpha/notes",
      headers: as(ALICE),
    });

    expect(res.json().notes).toEqual([]);
  });

  test("refuses to list an ungranted project's room", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/projects/beta/notes",
      headers: as(BOB),
    });
    expect(res.statusCode).toBe(404);
  });
});
