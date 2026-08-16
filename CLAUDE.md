# MemPalace Bot (mempalace_bot) — Claude Code Instructions

**Read [`.agents/WORKFLOW.md`](.agents/WORKFLOW.md) first** — it is the single
source of truth for all shared project instructions: current stage, settled
decisions, the one-way-write invariant, architecture, milestones, layout,
conditional instruction files, MemPalace usage, dev environment, checks, and
delivery rules.

**Before proposing or writing anything:** this project has no code and no git
history. Eight decisions are settled (R-1…R-8: Node throughout, bot + REST facade
in one monorepo, a project is a wing, an admin-run registry of published projects
with a per-user subset, one constant-key human room per project, Hetzner over
SSH); five material questions are still open and are listed in
`../docs/PROJECT.md`. Do not build ahead of them, and do not quote a proposal as
a decision.

The invariant that shapes everything: **the system reads broadly and writes to
exactly one segregated place, whose address is computed server-side.**

The rest of this file is Claude-specific and does not belong in the shared
workflow.

## Claude-specific notes

These apply to Claude Code only; other models can ignore this section.

- **MemPalace MCP** (`mcp__mempalace__*`) is available directly as tools. Note
  the double role: MemPalace is this project's *subject* and its *memory*.
  - For this project's own durable facts: `wing="mempalace_bot"`,
    `mempalace_get_project_guide project_name="mempalace-bot"`. The wing does not
    exist yet — the first write creates it.
  - When exploring how the palace behaves (wings, halls, access profiles) in
    order to design the facade, that is research — read widely, but do **not**
    write into other projects' wings.
  - Never use the family or private wings as a design example, and never surface
    their content in project documents.
- **TaskFrame MCP** (`mcp__taskframe__*`) is connected, but **no project exists
  for this work yet**. Do not file bot tasks into another project's key. When
  delivery starts, create the project, then record its key in
  `.agents/WORKFLOW.md`.
- When the user types `/<skill-name>`, invoke it via the Skill tool. Prefer the
  project workflow skills under `.agents/skills/` for multi-step engineering
  tasks (coordinator routes planner → … → fixer).
- Shared project detail is single-sourced in `.agents/WORKFLOW.md` — put project
  rules there, not here; keep this file to Claude-specific notes only.
