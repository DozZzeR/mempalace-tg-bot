---
description: "Use when writing, reviewing, or refactoring TypeScript/Node code in this project. Applies SOLID principles pragmatically: improve modularity, testability, and extensibility (palace adapters, gateway client, bot command routing) without over-engineering."
applyTo: "**/*.{ts,tsx,js,mjs}"
---

# SOLID Principles — Pragmatic Agent Instructions (TypeScript/Node)

Use SOLID as guidance, not dogma. Prefer simple, readable code. Add abstraction
only when it clearly reduces duplication, isolates change, or improves
testability. In this project the live drivers are: a palace adapter layer
(MemPalace access, whose transport is still open) and a gateway client the bot
depends on — DIP and OCP matter most.

Both the bot and the Palace Gateway are TypeScript, so these rules apply on both
sides of the wire without translation.

## Core Rule

Before changing code, identify:
- what responsibility this module/function has;
- what is likely to change (palace transport, a new bot command, a new project
  mapping);
- what should stay stable (the bot↔facade contract, the write-target rule);
- whether the change can be added without rewriting unrelated code.

Avoid large rewrites unless explicitly requested.

---

## S — Single Responsibility Principle

Each function or module should have one clear reason to change.

### Prefer
Separate decision-making from side effects, network calls, and formatting.

```ts
export function visibleProjects(user: User, registry: Project[]): Project[] {
  return registry.filter((p) => user.projectIds.includes(p.id));
}

export async function loadRegistry(store: RegistryStore): Promise<Project[]> {
  return store.published();
}
```

### Avoid
Mixing the rule, the IO, and the presentation in one function.

```ts
async function showProjects(ctx: Context) {
  const all = await fetch(`${PALACE}/wings`).then((r) => r.json());   // IO
  const mine = all.filter((w) => GRANTS[ctx.from.id]?.includes(w.name)); // rule
  await ctx.reply(mine.map((w) => `• ${w.name}`).join("\n"));         // format
}
```

The access rule is the part that must be independently testable — it is a
security boundary, not a filter.

### Agent behavior
When a file does too many things (e.g. a grammY handler that parses the update,
resolves permissions, and renders a reply), split only the part related to the
task. No unrelated "cleanup crusades".

---

## O — Open/Closed Principle

Open for extension, closed for unnecessary modification.

### Prefer
Registries, config, or small strategy objects when adding new cases.

```ts
const COMMANDS: Record<string, CommandHandler> = {
  start: startHandler,
  projects: projectsHandler,
  note: noteHandler,
};
```

### Avoid
Growing `if/else` chains every time a new command appears.

```ts
function route(cmd: string) {
  if (cmd === "start") ...
  else if (cmd === "projects") ...
  else if (cmd === "note") ...          // endless branching
}
```

### Agent behavior
A new bot command or a new palace transport should mean a new registry entry or
config value, not surgery on central branching. But do not build strategy
machinery for two trivial cases.

**One deliberate exception:** the write target is *closed to extension*. There is
one note writer and one address computation. Do not make it pluggable,
configurable per request, or overridable — that would turn the invariant into an
option.

---

## L — Liskov Substitution Principle

Any adapter implementation must honor the interface contract.

### Prefer
Consistent return shapes and error behavior across implementations.

```ts
interface PalaceAdapter {
  search(scope: Scope, query: string): Promise<Fragment[]>;
  writeNote(target: NoteTarget, note: HumanNote): Promise<NoteRef>;
}

class McpPalaceAdapter implements PalaceAdapter {
  async search(scope: Scope, query: string): Promise<Fragment[]> { ... }
}
```

### Avoid
Returning incompatible shapes or throwing unexpected errors from one
implementation.

```ts
class HttpPalaceAdapter {
  async search(scope: Scope, q: string) {
    return { hits: [...] };        // breaks the Fragment[] contract
  }
}
```

### Agent behavior
When adding or replacing an adapter, preserve input/output shape, error types,
timeout and empty-result handling, and side effects — unless the task explicitly
changes the contract. In particular, an adapter that returns *more* than the
scope allows is a contract violation, not a performance win.

---

## I — Interface Segregation Principle

Do not force callers to depend on fields they do not use.

### Prefer
Small focused interfaces and explicit DTOs.

```ts
type AskRequest = {
  projectId: string;
  question: string;
  askedBy: TelegramUserId;
};
```

### Avoid
Passing the whole Telegram context or a full palace record when two fields are
needed.

```ts
function buildAnswer(ctx: Context) {   // needs only projectId + text
  ...                                  // but receives the whole update + session
}
```

Passing narrow DTOs is also what keeps the bot from accidentally learning about
wings.

### Agent behavior
When adding parameters, prefer a narrow DTO or explicit args over bloating an
existing signature.

---

## D — Dependency Inversion Principle

High-level logic depends on abstractions, not concrete clients. This is the
backbone of both the palace adapter layer and the bot's gateway client.

### Prefer
Inject the adapter/client/clock; resolve concrete implementations at composition
root from configuration.

```ts
class AskService {
  constructor(
    private readonly gateway: PalaceGatewayClient,
    private readonly clock: Clock,
  ) {}
}
```

### Avoid
Hardcoding infrastructure inside application logic.

```ts
async function answer(question: string) {
  const r = await fetch("http://127.0.0.1:4119/search", { ... });  // nailed in
}
```

### Agent behavior
When code mixes rules with HTTP/filesystem/clock/global state, extract the
boundary if it helps the task. Do not build an architecture cathedral for a
one-off script.

---

## Practical Refactoring Rules

### Prefer
- small pure functions; explicit names; narrow modules;
- composition over inheritance;
- configuration/registries over duplicated branches;
- dependency injection where tests or the adapter boundary benefit;
- preserving existing public contracts (the bot↔facade wire shape);
- minimal diffs.

### Avoid
- god modules that accumulate handlers;
- hidden side effects — especially any write triggered by a read path;
- hardcoded infrastructure inside application logic;
- premature factories/managers for trivial cases;
- interfaces with one unclear implementation;
- changing unrelated behavior during refactoring.

---

## Agent Checklist

Before finalizing a change, verify:

1. Does each changed function/module have a clear responsibility?
2. Can a new command / palace transport be added without editing unrelated code?
3. Did I preserve existing contracts and return shapes?
4. Do callers depend only on what they actually need?
5. Are external dependencies isolated enough for testing (fake at the boundary)?
6. Is the abstraction worth its cost?
7. **Did any access rule or write-target computation move out of the facade's
   service layer, or become configurable by a caller?** If yes, revert it.
8. Is the diff minimal and related to the requested task?

If a SOLID rule conflicts with simplicity, choose the simpler design and explain
why. If it conflicts with the write boundary, the boundary wins.

## When to bend the rules

- Tiny scripts and one-off deploy helpers: SRP and DIP overhead may not pay off.
- Prototyping/spikes: move fast, mark with `// TODO: refactor for SRP` so it is
  tracked.
- Never for access rules or the write target — those get the strict treatment
  even in a spike.
