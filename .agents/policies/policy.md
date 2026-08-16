# MemPalace Bot (mempalace_bot) — Agent Delivery Policy

Local-first, skill-first delivery rules for this project. Durable decisions go to
MemPalace (project `mempalace-bot`, wing `mempalace_bot`). See `AGENTS.md` /
`CLAUDE.md` → `.agents/WORKFLOW.md` for stage, environment and instruction
routing.

## Stage gate — read before doing

**M0 is complete and M1 is the current milestone.** There is code and a green
`npm run check`, but still **no git repository** — the owner adds it later. Ten
decisions are settled (R-1…R-10, see `.agents/WORKFLOW.md`); D-2, D-5 and D-7
remain open and live in `../docs/PROJECT.md`.

- Settle each remaining question inside the milestone that needs it — D-2 in M1,
  D-7 in M4, D-5 in M5. Do not pre-empt one from an earlier milestone.
- Do not restate a proposal as a settled decision — in code, docs, commit
  messages or anything shown to the user. The facade contract sketch is still a
  proposal; the layout, the room name and the state store are not.

## The write boundary — the rule that outranks the others

The system reads broadly and writes to exactly one segregated place. Concretely,
for any change you make:

- **The write address is computed server-side** from the project identifier plus
  two constants. If a request body, query parameter, or bot message can influence
  the target wing, hall or room, that is a defect — stop and say so, even if it
  was asked for.
- **One write path.** If a second place in the code can write to MemPalace,
  something is wrong with the design. Raise it rather than adding the second one.
- **Private and family wings are denied unconditionally** — not by allowlist, not
  by configuration, and not by a default that a config file can flip. They cannot
  be entered into the project registry; the registry must reject them rather than
  trust that nobody will try.
- **Do not write to another project's wing while developing.** Development
  writes go to `wing=mempalace_bot`, `hall=decision`, by you, as decisions. Never
  exercise the bot's write path against a real project wing without the user
  saying so.
- Any change to what a person can see — publishing a wing into the project
  registry, admitting a user, widening someone's project set — requires explicit
  user approval. It is a disclosure decision, not a config tweak.

## Task context before development

- For non-trivial changes, record task context first: goal, acceptance criteria,
  affected area, and the verification route.
- A tracker task or a short note is enough — do not block on external trackers.
  No TaskFrame project exists for this work yet.
- Tiny mechanical edits and investigation-only work need only a concise note.

## Repository and branch safety

- `repo/` is not yet a git repository. Do not run `git init` or any git write
  without being asked — the owner has said git comes later, before the Hetzner
  deployment (M4). `.gitignore` is already written and covers `.env` and the
  SQLite state file.
- Once it is: find the git root before any git write; inspect branch, status and
  existing user changes first.
- Do not commit or push unless the user asks. If on the default branch, create a
  short-lived `feature/<kebab>` or `fix/<kebab>` branch first.
- Before any push, re-check the diff, summarize the included files, and confirm
  verification was run — or state plainly what is missing.
- Never rename, rewrite, discard, or merge existing user work silently.

## Commits

- Commit only when the user asks for a commit or delivery step.
- Conventional subjects (`feat:`, `fix:`, `refactor:`, `docs:`), focused and
  logically complete. Stage only files belonging to the task.
- Never commit secrets, `.env`, the Telegram bot token, facade credentials, or
  any MemPalace access token or host detail.
- No debug or checkpoint commits.

## Documents and the brief

- `../docs/` is outside the repository. `PROJECT.md` is the human-facing brief;
  keep it and `.agents/WORKFLOW.md` consistent — when a decision or milestone
  changes, change the brief first, then mirror the short form into the workflow.
- Russian for the brief and anything a person reads in Telegram; English for code
  identifiers, MemPalace content and these instruction files.

## Testing and runtime

- `npm run check` (lint + typecheck + test) must be green before any change is
  called done. The `no-restricted-syntax` lint rule guarding hall/room literals
  is load-bearing — do not disable it to make a change fit.
- Two test classes are not optional once the corresponding code exists:
  **access-filter tests** (a user without a wing gets zero fragments from it, via
  every route) and **write-target tests** (no field manipulation reaches another
  wing, hall or room). See `.agents/instructions/TDD.instructions.md`.
- Do not bypass or disable failing tests unless the user explicitly authorizes it
  for the current task. If tests can't run, state the exact blocker and residual
  risk.

## External actions require approval

Deployment to Hetzner, destructive data operations, anything that writes into
MemPalace outside this project's own wing, and external provider calls that may
create cost or obligations require explicit user approval. The agent can report
missing evidence but must not claim to guarantee production state, deployment
safety, or access-control behaviour it has not directly verified.
