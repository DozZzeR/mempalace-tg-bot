---
name: backend-rules
description: "Use for server-side development, architecture, and API refactoring in this project. Enforces layer boundaries (Telegram transport, bot services, facade endpoints, palace adapters, DTOs) and the read/write boundary that separates broad reads from the single segregated write target."
[TRIGGER]: Activate ONLY for server-side code — bot handlers, facade endpoints, services, palace adapters, DTOs, deploy scripts.
---

# Skill: Backend Layering & Boundaries

> **Layout not yet created.** The project is at pre-start; see
> `.agents/WORKFLOW.md`. Both the bot (grammY) and the Palace Gateway are
> Node/TypeScript, in one monorepo, as separate processes. The concrete module
> layout is fixed at M0 — do not create it before then.

## Core Mandate

Pragmatically enforce layered architecture. Keep Telegram concerns, application
logic, access rules, and palace access strictly isolated. Avoid "fat" handlers
and MemPalace details leaking into presentation code.

## Layer Responsibilities

- **Telegram transport (grammY handlers, middlewares, keyboards):** protocol and
  presentation only. Parse the update, delegate to a bot service, format the
  reply, paginate. No access decisions, no palace calls, no business rules.
- **Bot services (application layer):** conversation flow, session state, what to
  ask next, how to turn a facade response into something a person can read. Calls
  the facade through a client interface, never raw HTTP inline.
- **Facade endpoints (Palace Gateway transport):** validate the request, resolve
  the caller, delegate to a service, shape the response. Thin.
- **Facade services:** the rules — who may see which wings, how a project maps to
  palace addresses, how the write target is computed. **This is the only layer
  allowed to decide access.**
- **Palace adapters (infrastructure):** isolate MemPalace behind an interface —
  search, drawer fetch, note write. Normalize palace payloads here so no other
  layer sees raw palace shapes. Whether it reaches the palace via MCP, HTTP, or a
  direct import (D-2) must be invisible above this line.
- **DTOs / schemas:** the wire contract between bot and facade, decoupled from
  both Telegram and MemPalace internals.

## Architectural Guardrails

- **No fat handlers.** A grammY handler that parses the message, decides what the
  user may see, calls the palace, and formats the answer is the primary smell.
- **No palace access outside adapters.** Every read and write goes through the
  adapter interface (Dependency Inversion). See `SOLID.instructions.md`.
- **No access logic in the bot.** If the bot has to know what a wing is in order
  to decide something, the rule is in the wrong process. Move it into the facade.
- **Avoid architecture cathedrals.** Do not introduce repositories, factories or
  extra layers for two trivial cases. Prefer plain modules and functions.
- **Preserve ecosystem style.** Mirror the existing module structure. No cleanup
  crusades in unrelated files.

## The read/write boundary — the outermost boundary

The system **reads broadly and writes to exactly one segregated place**. This
outranks every other layering rule; enforce it above all others.

- **The write target is computed, never received.** The facade derives
  `wing/hall/room` from the project identifier and its own configuration. If any
  request field can influence it — directly, or through a lookup keyed by user
  input — that is the bug to fix.
- **One write path in the whole codebase.** A second function capable of writing
  to MemPalace is a design failure, not a convenience. If a task seems to need
  one, raise it.
- **Private and family wings are denied unconditionally**, above and before the
  per-user allowlist. A misconfigured allowlist must not be able to expose them.
- **Three access cuts, each independent:** the user allowlist, the admin-run
  registry of published projects, and the per-user project set (default: the
  whole registry). A project outside a user's set is invisible — absent from
  listings, absent from search results, and indistinguishable from "does not
  exist" in error responses. Note that "the user's maximum" means the registry,
  never "every wing in the palace": a wing nobody published must never surface.
- **Reads stay read.** No code path may mutate palace state as a side effect of a
  read — no touch counters, no access logs written into project wings.

Once the module layout exists (M0), add the concrete grep/lint checks that verify
"only `palace/noteWriter` imports the write call" here.

## Code Contrast

**AVOID — fat handler (transport + access decision + palace call + formatting):**

```ts
bot.on("message:text", async (ctx) => {
  const wing = ctx.session.wing;                       // access state in the bot
  if (!ALLOWED.includes(ctx.from.id)) return;          // rule in the wrong layer
  const res = await fetch(`${PALACE}/search?wing=${wing}&q=${ctx.message.text}`);
  const hits = await res.json();                       // raw palace shape leaks
  await ctx.reply(hits.results.map((r) => r.text).join("\n\n"));
});
```

Beyond the layering, the `wing` in that URL is the invariant violation: the
caller is choosing where to look.

**PREFER — thin handler delegating to a service that uses a client interface:**

```ts
bot.on("message:text", async (ctx) => {
  const answer = await ask.forProject(ctx.session.projectId, ctx.message.text, ctx.from.id);
  await ctx.reply(render(answer), { parse_mode: "HTML" });
});
```

`ask` depends on a `PalaceGatewayClient` interface; the facade resolves the
caller's permissions and the palace addresses itself. The bot passes a project
id and a user id — never a wing.

## Post-Execution Check

Before outputting code, verify:

- Is the handler thin (parse → delegate → respond)?
- Is the logic testable without Telegram and without a live palace?
- Is palace access behind an adapter interface, not inline?
- Does any access decision live outside the facade's service layer? (It must not.)
- **Can any input reach the write target computation?** Trace it. If a value the
  user controls appears anywhere in the address, stop.
- Is the diff minimal and contained to the owning module?
