---
description: "Use when writing, reviewing, or refactoring tests in this project. Enforces test-first discipline, a clear unit/integration/contract test split, faking only at external boundaries (MemPalace, Telegram, HTTP), and the two mandatory security test classes: access filtering and write-target integrity."
applyTo: "**/*.{test,spec}.{ts,js}"
---

# TDD — TypeScript / Node Instructions

Write the failing test first. Then implement the minimum code to make it pass.
Then refactor. Red → Green → Refactor.

> **Runner not chosen yet.** The project has no code (see `.agents/WORKFLOW.md`).
> Vitest is the proposed default and is what the examples use; confirm it at M0
> and replace this note with the real commands. Bot and facade are both
> TypeScript, so one runner covers the whole monorepo.

```bash
npm test                     # whole suite
npm test -- src/facade        # one area
```

Tests live next to the code they cover: `foo.ts` → `foo.test.ts`.

## Core Rule

Before writing feature code, identify:
- what behavior this test guarantees;
- what level it belongs to (unit / integration / contract);
- the minimum scope of the test;
- what is real vs faked (fake only external boundaries).

Test observable behavior, not implementation details.

## Test Levels

### Unit — pure functions, services, rules
Real: the function or service under test.
Fake: MemPalace, the Telegram API, outbound HTTP, the clock.

```ts
test("hides a project the user was not granted", () => {
  const user = makeUser({ projectIds: ["alpha"] });
  const visible = visibleProjects(user, [project("alpha"), project("beta")]);
  expect(visible.map((p) => p.id)).toEqual(["alpha"]);
});
```

Access rules and the write-target computation are pure by design — keep them
that way, so they can be tested exhaustively without any IO.

### Integration — a slice with real wiring, faked edges
Real: the facade's routing, validation, services and DTO mapping, wired together.
Fake: the palace adapter and outbound HTTP only.

```ts
test("search returns no fragments from an ungranted wing", async () => {
  const palace = new FakePalace({ alpha: [frag("a")], beta: [frag("b")] });
  const app = buildFacade({ palace, grants: { 42: ["alpha"] } });

  const res = await request(app).get("/projects/beta/search?q=x").set(asUser(42));

  expect(res.status).toBe(404);          // indistinguishable from "does not exist"
});
```

Do not fake the layer under test. Prefer small hand-written fakes that honor the
adapter interface over deep module mocking.

### Contract — the bot↔facade wire shape
Real: the DTOs both sides depend on. Assert that a response the facade produces
is one the bot's client accepts, and that neither side silently widens the shape.

## Test Naming

`<behavior> when <context>` — a sentence, not a label.

```ts
test("denies a note write when the body carries an explicit wing", ...)
test("returns 404 for a project the caller was not granted", ...)
test("never lists a private wing, even when it is in the grants", ...)
```

Avoid `test 1`, `works`, `search`.

## What to Fake — Decision Table

| Dependency | Unit | Integration / Contract |
|---|---|---|
| Access rules, write-target computation | **Real, always** | **Real, always** |
| MemPalace (any transport) | fake | fake |
| Telegram Bot API | fake | fake |
| Outbound HTTP | fake | fake |
| Bot state store | in-memory | in-memory or real temp store |
| Clock, random, ids | injected fake | injected fake |

Fake at system boundaries only. **Never fake or stub the access filter or the
write-target computation** — they are the things under test, everywhere.

## Arrange / Act / Assert

One behavior focus per test.

```ts
test("stores a note under the constant key", async () => {
  // Arrange
  const palace = new FakePalace();
  const app = buildFacade({ palace, grants: { 42: ["alpha"] } });
  // Act
  await request(app).post("/projects/alpha/notes").send({ text: "idea" }).set(asUser(42));
  // Assert
  expect(palace.writes).toEqual([
    { wing: "alpha", hall: "human", room: "notes", text: "idea", source: "tg_bot" },
  ]);
});
```

## Mandatory security tests

These two classes are not optional. Every new endpoint, handler, or adapter that
touches the palace needs its matching test before the code is considered done.
They map directly to the invariant in `.agents/WORKFLOW.md`.

1. **Access filtering.** For every route that can return palace content: a user
   whose project set does not include a project gets **zero** fragments from it —
   through listing, through search, and through direct drawer fetch by key. A
   guessed identifier must not leak existence: assert the same response as for a
   nonexistent project.
2. **Write-target integrity.** For every write path: a request that carries an
   explicit `wing`, `hall`, `room`, path traversal, or an injected field cannot
   move the write. Assert on the *recorded write*, not on the response status —
   a 200 with the note in the wrong room is the failure this test exists to
   catch.
3. **Registry containment.** A wing that is not in the project registry never
   surfaces, even though the palace has it. And a private or family wing stays
   invisible **even when it is entered into the registry by hand** — that is the
   test proving misconfiguration cannot expose it.
4. **Read purity.** A read path performs no writes. Assert the fake palace
   recorded zero writes after a search or a fetch.

## When to skip TDD

- Exploratory spikes — add the test afterward to lock in the found behavior.
- Pure infra setup (compose files, systemd units, deploy scripts) — not
  meaningful to TDD; mark with `// TODO: add test` before merge.
- **Never** for access filtering or the write target. Those are written test-first
  even in a spike.
