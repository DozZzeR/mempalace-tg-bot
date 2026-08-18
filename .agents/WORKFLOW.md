# MemPalace Bot (mempalace_bot) — Shared Workflow

Single source of truth for shared project instructions. `CLAUDE.md` and
`AGENTS.md` both point here; keep project detail in this file so the two entry
files never drift. (Model-specific notes stay in `CLAUDE.md`.)

The product: a Telegram bot that gives **people** a window into MemPalace —

> open the bot → see one button per project you are allowed to see → enter a
> project → ask about a topic and get what the palace has recorded → leave your
> own thought, plan, or (later) a message to another person, stored in that
> project's one human room.

Everything the bot touches is read-only except that one segregated write target.

## READ FIRST — nothing is built yet

State as of **16 August 2026**:

- `repo/` **is the git root**, branch `main`, remote
  `git@github.com:DozZzeR/mempalace-tg-bot.git`. `docs/` stays outside it, so
  `docs/PROJECT.md` is not on GitHub;
- fifteen decisions are settled (below); one material question remains open
  (D-5, model synthesis) and is tracked in `../docs/PROJECT.md`;
- **the bot is deployed and running** on Hetzner at `~/projects/mempalace-bot`
  under PM2 as `mempalace-gateway` and `mempalace-bot`. See `deploy/README.md`;
  deploying is `deploy/deploy.sh`, rolling back is `deploy/rollback.sh <sha>`;
- **M0 and M1 are complete in code**: monorepo and tooling; the gateway with all
  three access cuts, its routes, the SQLite state store and the MCP palace
  adapter. `npm run check` is green, 15 tests;
- **one thing blocks M1 from being finished outright**: the palace credential.
  The developer's MCP token is full-access — it can see the family wing — so the
  gateway must not reuse it, and the adapter has never been run against the live
  palace. `PALACE_AUTHORIZATION` is required with no default until the owner
  provisions a narrowed credential. Do not work around this by borrowing the
  developer's token;
- **M2 is the current milestone** — the bot showing project buttons and answers;
- the brief in `../docs/PROJECT.md` is the human-facing map of the project. Read
  it before proposing anything about scope or architecture.

Two rules follow, and they hold until the user says otherwise:

1. **Do not build ahead of the open questions.** Each remaining one is settled
   inside the milestone that needs it: D-2 (palace transport) in M1, D-7
   (polling vs webhook) in M4, D-5 (model synthesis) in M5. Do not pre-empt them
   from an earlier milestone.
2. **Never present a proposal as a decision.** The settled decisions are the ten
   in the table below. Everything else — the contract sketch in particular — is
   proposed. Say "proposed", not "the system uses".

## Settled decisions

| # | Decision |
|---|---|
| R-1 | Bot stack: **Node.js + grammY**, TypeScript |
| R-2 | MemPalace access: a **new REST facade** ("Palace Gateway") with its own narrow contract — not a direct core import, not an MCP client inside the bot |
| R-3 | Access control: **allowlist by Telegram user_id**, plus a per-user set of visible projects |
| R-4 | Hosting: **Hetzner over SSH**. Local development first; git and deployment come later |
| R-5 | The facade is **Node/TypeScript too** — a separate process, one monorepo with the bot |
| R-6 | **A project is a wing**, one to one. "Project" is what a person sees on a button; "wing" is what it is called inside the palace. Only the facade knows the mapping |
| R-7 | A **registry of published projects**, maintained by an admin, sits between the palace and people. A user's maximum is the whole registry — never "every wing in the palace" |
| R-8 | Each project has **one human room with a constant key**, identical across projects and not configurable per wing |
| R-9 | The human room is named **`notes`**, not `drafts` — it holds plans and messages as well as rough thoughts (closes D-4) |
| R-10 | State (allowlist, registry, per-user project sets, rate limits) lives in **SQLite**. Node 25 is installed, so built-in `node:sqlite` is used and no native module is compiled (closes D-6) |
| R-11 | The gateway reaches the palace over **MCP streamable HTTP** via `@modelcontextprotocol/sdk`. Its credential must be a separate, narrowed one — never a developer's full-access token (closes D-2) |
| R-12 | The gateway's HTTP framework is **Fastify**, chosen once real routes existed. `inject()` gives route-level tests without binding a socket or adding a test-client dependency |
| R-13 | **Long polling**, not a webhook (closes D-7). Bot and gateway share a host and the gateway binds loopback; polling needs no inbound port, certificate, or proxy entry |
| R-14 | Processes run under **PM2**, not systemd — the box already boots PM2 and has `pm2-logrotate`; a second supervisor is a second place to look when something is down |
| R-15 | The Node path in the PM2 config is **absolute**. Three versions exist on the box, a non-interactive shell picks v18, and only v25 has `node:sqlite` unflagged |
| R-16 | The gateway reaches the palace over **loopback** at `127.0.0.1:4118` (`mem-palace-common-http`). Nothing crosses the network and no credential leaves the machine |

### Access model — three independent cuts

1. **Allowlist** — Telegram user_id. Not listed, no answer at all.
2. **Project registry** — which wings are published as projects. Private and
   family wings cannot be added; that is not a setting.
3. **Per-user project set** — a subset of the registry. Default is the whole
   registry; an admin narrows it per person.

The buttons a user sees are cut 3. A project outside a user's set does not exist
for them: absent from listings, absent from search, and a direct request by id
answers exactly as it would for a nonexistent project.

Inside a visible project, read and write are not yet separated — seeing a project
means being able to write in it. A read-only tier is an M5 candidate.

### The human room — constant key

```
wing = <the project's wing>     the only variable part
hall = human                    constant
room = notes                    constant  (R-9)
```

A separate *hall*, not merely a room, so that an agent reading project memory can
tell a human note from a ratified decision by address alone. Server-set metadata:
`telegram_user_id`, `author_name`, `created_at`, `source=tg_bot`, `kind`
(`thought|plan|message`) and `to` for messages. `kind` and `to` exist from day one
so person-to-person messages (M5) need no change of record shape.

## The one invariant

This survives any stack change and should shape every design choice:

> **One-way write.** The bot, and everything behind it, has exactly one write
> target in MemPalace — the project's human room, whose key is constant across
> all projects. No user input and no request parameter can redirect a write
> anywhere else. The models' working memory (decisions, ADRs, domain, code) is
> read-only to this system.

Binding consequences:

- **The write address is computed server-side** from the project identifier plus
  two constants. The bot neither sends nor can send a target wing, hall or room.
  A facade endpoint that accepts a destination from the client is a bug, not a
  feature.
- **Human notes never mix with model memory.** The `human` hall exists precisely
  so the distinction is visible in the address.
- **Private and family wings are unreachable through the bot** under any
  configuration, and cannot be entered into the project registry. This is not
  covered by the user allowlist — it is a separate, unconditional deny.
- **The bot never sees a wing name.** It works with project identifiers issued by
  the facade. If bot code needs to know what a wing is, a rule has leaked into
  the wrong process.
- Removing the bot must leave the palace exactly as it was, minus the human
  rooms.

A second invariant, weaker but also cross-cutting: **the bot does not decide for
the human.** It returns what is recorded, with its source (wing/hall/room). If an
answer is synthesized by a model, that is labelled, and the source fragments stay
reachable.

## Architecture — three layers, three responsibilities

```
Telegram → Bot (grammY, TS) → Palace Gateway (facade, TS) → MemPalace
```

- **Bot** — Telegram transport and presentation. Buttons, message-length limits,
  pagination, conversation state. Knows nothing about wings and makes **no access
  decisions**.
- **Palace Gateway** — the only place rules live: the allowlist, the registry,
  per-user project sets, the project→wing mapping, and where writes may land.
  Everything security-relevant is here, so this is the component that gets
  audited. Separate process from the bot on purpose — the boundary should be
  checkable, not merely conventional.
- **MemPalace** — the data source. Existing system; we do not rewrite it.

Proposed facade contract (to be fixed at M1):

| Method | Purpose |
|---|---|
| `GET /projects` | projects visible to this user — the bot's buttons |
| `GET /projects/{id}/search?q=` | search within a project, with fragment provenance |
| `GET /projects/{id}/drawers/{key}` | full text of one drawer |
| `GET /projects/{id}/notes` | the project's human room — what people have written |
| `POST /projects/{id}/notes` | the **only** write; address computed server-side |

`{id}` is a registry project id, never a wing name.

Repo layout, as built at M0:

```
repo/
├── apps/
│   ├── bot/            grammY, TypeScript — transport and presentation only
│   └── gateway/        REST facade, TypeScript — every rule lives here
│       └── src/palace/noteTarget.ts    the one write-address computation
├── packages/
│   └── contract/       the bot↔gateway wire types — no wing, hall or room in it
├── deploy/             systemd / compose, reverse proxy (M4)
└── .agents/            these instructions
```

Two structural guards worth knowing before you add code:

- `packages/contract` deliberately cannot express a palace location. If a task
  seems to need a wing on the wire, the rule has leaked out of the gateway.
- `Wing` in `noteTarget.ts` is a branded type minted only by `wingFromRegistry`.
  A string off a request body cannot reach the address computation even by
  accident — the type system carries the invariant, not just the comments.

## Milestones

Hard order — M2 is pointless without M1, M3 is unsafe without it.

| # | State reached | Done when |
|---|---|---|
| M0 | Foundation: monorepo laid out, both apps start empty, env-based config, shared contract package, lint/typecheck/test run | one command runs lint + typecheck + tests green; no secrets in the repo |
| M1 | Facade reads: `/projects` and `/search` return real MemPalace data; all three access cuts work; D-2 closed | a test proves a user without a project in their set gets **zero** fragments from it — via list, search *and* direct id; a test proves private/family wings stay unreachable even if entered into the registry by hand |
| M2 | Bot reads: `/start`, project buttons from the user's set, enter project, ask, answer with provenance, pagination | a real person on a phone gets a useful answer and sees exactly the buttons they should |
| M3 | People write: one endpoint into `human/notes`, server-computed address, automatic metadata, own room readable in the same screen | the note appears under the constant key; a test proves no field manipulation writes to another hall, room or wing |
| M4 | Operations: git, SSH deploy to Hetzner, autostart for both processes, logs, rotation, state backup, rollback; D-7 closed | the bot survives a server reboot unattended; deployment is one recorded command |
| M5 | Polish: admin commands (allowlist, registry, project sets), rate limits, clean errors, metrics. Candidates: delivering `kind=message` to its addressee, a read-only tier, model synthesis (D-5) | people use it and don't complain |

Full detail, including the open questions, lives in `../docs/PROJECT.md`. Keep the
two consistent: if a milestone or a decision changes, change it there first, then
mirror the short form here.

## Layout

```
mempalace_bot/                  launch wrapper (not the git root)
├── AGENTS.md, CLAUDE.md        thin pointers into repo/
├── docs/                       NOT part of the repository
│   └── PROJECT.md              the project brief — decisions, questions, plan
└── repo/                       will become the git root (.git lands here)
    ├── AGENTS.md, CLAUDE.md    thin pointers into .agents/
    └── .agents/
        ├── WORKFLOW.md         this file — all shared project instructions
        ├── policies/policy.md  delivery, git and safety policy
        ├── instructions/       SOLID, TDD — loaded conditionally
        └── skills/             00-coordinator … 06-fixer, backend-rules
```

`docs/` sits **outside** `repo/` on purpose: briefs and analysis have a lifecycle
that is not the code's. Reference it as `../docs/…` from inside the repo, and do
not move it in without being asked.

## Conditional instruction files

Read the relevant file(s) at the start of a matching task. Do not load all of
them unconditionally.

| Trigger | File |
|---|---|
| Any server-side code change — bot handlers, facade endpoints, services, adapters | `.agents/instructions/SOLID.instructions.md` |
| Layering review — fat handlers, service/adapter split, the read/write boundary | `.agents/skills/backend-rules/SKILL.md` |
| Writing or reviewing tests | `.agents/instructions/TDD.instructions.md` |
| Complex or risky task — needs planning, investigation, staged delivery | `.agents/skills/00-coordinator/SKILL.md` (routes 01-planner → 06-fixer) |

## MemPalace — shared memory across models and sessions

MemPalace is both this project's **subject** and its shared memory. Keep the two
uses apart: the bot reads project wings on behalf of humans; you, as an agent,
write this project's own durable decisions into its own wing.

- **Project name:** `mempalace-bot`
- **Wing:** `mempalace_bot` — does not exist yet; it is created by the first
  write. Always scope reads and writes to it.

Load the project guide via MCP using whichever surface your client supports (any
one is enough — they return the same instructions):

1. `prompts/get name="mempalace-project-guide"`
2. `resources/read server="mempalace" uri="mempalace://guides/project/mempalace-bot"`
3. `tools/call name="mempalace_get_project_guide" project_name="mempalace-bot"`

`mempalace_search` first for task context; `mempalace_get_drawer` only when you
need exact full content. `hall="code"` is the read-only mined codebase structure
— never write to it manually. Write durable facts to `hall="decision"` with
`wing="mempalace_bot"` and a concise lowercase_underscore room name, in English.
No transient logs, no secrets, no guesses; check for duplicates first.

**`hall="human"` is READ-ONLY to models — never modify it.** Drawers with
`hall="human"` (equivalently `added_by="tg_bot"`, the human room `notes`, body
starting with `MemPalace Bot note` + a `kind:` line such as `plan`) are the
owner's own hand-filed notes — product ideas, plans, todos. This is the very
`human` hall this bot exposes (R-8/R-9): people write it, models don't. A model
may **read and cite** it, but must **never** `mempalace_update_drawer`,
overwrite, delete, or "consolidate" it, and must not fold it into any dedupe —
in `wing="mempalace_bot"` or in **any** project wing the gateway serves. Not
auto-surfaced by semantic search (short, keyword-poor), so find by structure:
`mempalace_list_drawers wing=<project> room=notes` (or filter on `hall="human"`).
When planning or orienting, **list `room=notes` and, if a note resonates with the
work in play, surface it to the owner** as a suggestion, not an instruction to
execute; judge relevance yourself over the full (small) listed set. Turn a note
into action only when the owner asks.

Rooms worth seeding: `project_overview`, `decisions`, `open_questions`,
`gateway_contract`, `access_model`, `human_room_key`, `constraints_blockers`,
`conventions`.

### What goes where

Keep these separate. Mixing them is what makes a later session stumble.

- **MemPalace** (`wing=mempalace_bot`, `hall=decision`) — durable *why*: the
  one-way-write invariant, R-1…R-8, the facade contract once fixed, the access
  model, non-code constraints and blockers, conventions. Store only what changes
  rarely.
- **TaskFrame** — live, volatile work: tasks, statuses, acceptance criteria.
  Source of truth for *what is being done now*. **Never mirror task statuses into
  MemPalace.** *No TaskFrame project exists for this work yet; create one when
  delivery starts and record its key here.*
- **`../docs/PROJECT.md`** — the human-facing brief: decisions, open questions,
  milestones. The place a person is pointed at.
- **This repo** (`.agents/`) — the *how*: stack, commands, layering, rules.

Note the naming collision and do not fall into it: `wing=mempalace_bot`,
`hall=decision` is **our** memory as engineers. The `human` hall inside a project
wing is what the bot writes on behalf of people. They are never the same place.

### When to update MemPalace

Write a drawer when, and only when:

- a durable architecture or design decision is made or changed (including any
  answer to D-2, D-5, D-7);
- the facade contract, the access model, or the human-room key is fixed or moves;
- a non-code constraint or blocker appears or resolves (what may be exposed to
  which people, a dependency on the MemPalace side, a pending answer);
- a milestone (M0…M5) is reached.

Do **not** write for: task status changes, routine edits, transient debugging, or
anything derivable from code and git. When a stored fact changes, invalidate or
replace the old drawer rather than appending a contradicting one.

## Dev environment

Node **22.18+** (dev machine runs 25.2). npm workspaces; no build step — sources
are TypeScript and Node strips types at load, so `node apps/bot/src/index.ts`
runs directly. Consequences to respect: imports carry a `.ts` extension, and
non-erasable syntax (`enum`, parameter properties, namespaces) will not run.
`erasableSyntaxOnly` in `tsconfig.base.json` catches that at typecheck time.

```bash
npm install
cp .env.example .env       # then fill it in
npm run gateway            # http://127.0.0.1:8787
npm run bot
```

Configuration is read from the environment only, via `--env-file-if-exists=.env`.
`.env` is gitignored; `.env.example` documents every variable. The bot token,
the gateway shared secret, the state-store path and the palace URL never appear
in code.

Workspaces: `apps/bot`, `apps/gateway`, `packages/contract`. The contract package
is consumed straight from source (`exports` points at `src/index.ts`).

## Checks

```bash
npm run check              # lint + typecheck + test, in that order
```

Individually: `npm run lint`, `npm run typecheck`, `npm run test`
(`npm run test:watch` while working).

One lint rule is load-bearing rather than stylistic: `no-restricted-syntax` in
`eslint.config.js` forbids the literals `human` and `notes` as a `hall`/`room`/
`wing` property anywhere except `apps/gateway/src/palace/noteTarget.ts` and its
test. That is the invariant enforced mechanically — if a task seems to require
disabling it, the design is wrong, not the rule.

Do not bypass or disable failing checks unless the user explicitly authorises it.

## Delivery rules

- Record task context before non-trivial changes: goal, acceptance criteria,
  affected area, verification route. Tiny mechanical edits need only a note.
- Do not commit or push unless the user asks. Once `repo/` is a git repository:
  if on the default branch, branch first.
- Commit only files relevant to the task; never commit secrets, `.env`, the
  Telegram bot token, palace credentials, or the state store.
- **Never write to MemPalace on a person's behalf as a side effect of a code
  change.** Development writes go to this project's own wing, as decisions, by
  you — not into anyone's project memory through the bot's path.
- **Publishing a project into the registry, or widening someone's project set, is
  a disclosure decision** and needs explicit user approval. It is not a config
  tweak.
- Deploying to Hetzner and any destructive data operation require explicit user
  approval.
- When the brief and the user disagree, the user wins, and the disagreement is
  worth a MemPalace drawer.
