# MemPalace Bot

A Telegram bot that gives people a window into MemPalace: one button per project
you are allowed to see, ask about a topic, get what the palace has recorded, and
leave your own note.

**Agents start at [`.agents/WORKFLOW.md`](.agents/WORKFLOW.md).** Humans start at
[`../docs/PROJECT.md`](../docs/PROJECT.md) — decisions, open questions, plan.

## The invariant

The system reads broadly and writes to exactly one place: each project's human
room, at a key that is constant across projects. The write address is computed
server-side from the project identifier plus two constants; no request field can
redirect it. See `apps/gateway/src/palace/noteTarget.ts` — the one file allowed
to name a hall or a room, enforced by a lint rule.

## Layout

```
apps/bot/          Telegram transport and presentation (grammY). No access rules.
apps/gateway/      Palace Gateway — the only holder of rules and palace access.
packages/contract/ The wire contract between them. Carries no wing, hall or room.
deploy/            Deployment material (M4).
```

## Getting started

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env`, then:

```bash
npm run check
```

Runs lint, typecheck and tests. Individual apps:

```bash
npm run gateway
```

```bash
npm run bot
```

Requires Node 22.18+ (24+ recommended) — sources are TypeScript and run directly
through Node's type stripping, so there is no build step.

### Running against a fake palace

The gateway needs a MemPalace credential. To work on the bot without one:

```bash
npm run gateway:dev
```

That is a separate entry point (`apps/gateway/src/dev/devServer.ts`), not a
fallback inside the real one — a production entry that quietly runs on fake data
when a credential is missing is the kind of convenience that eventually ships.
Set `DEV_SEED_USER` to your Telegram user id so the seeded allowlist includes
you.

## Status

M0 and M1 complete; M2 (the bot's read path) complete in code. 40 tests.

Outstanding: `PALACE_AUTHORIZATION` — the gateway has never run against the live
palace. It needs a credential narrower than a developer's full-access token,
because a full-access token can write to any hall, which would leave the
one-way-write invariant resting entirely on this code.
