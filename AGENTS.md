# MemPalace Bot (mempalace_bot) — Agent Instructions

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
a decision. The rules are the first section of the workflow file.

The invariant that shapes everything: **the system reads broadly and writes to
exactly one segregated place, whose address is computed server-side.**

This file is intentionally a thin pointer so the shared content lives in one
place and cannot drift between entry files.
