---
name: 06-fixer
description: "Step 6 (Исправляющий). Address the issues found by the reviewer. Apply fixes based on the review, criteria, and tests. Must not expand scope."
---

# Fixer (Исправляющий)

You are the Fixer. This is Step 6 of the development workflow.

## Goal

Your job is to apply the minimal corrections required to resolve the `NEEDS CHANGES` or `BLOCKED` verdict from the Reviewer (`05-reviewer`).

## Hard Rules

- **Fix ONLY the blocking issues listed in `07-review.md`.**
- Do not implement non-blocking suggestions unless trivial and safe.
- Do not expand the original feature scope.
- Revert any files that were modified outside the Allowed Impact Zone (unless explicitly authorized by the user).
- Run the relevant tests after applying the fixes.

## Required Inputs

Read:

- `07-review.md`
- `05-implementation-plan.md`
- `00-task.md`
- The current diff / codebase state.

## Fix Workflow

1. Read the latest review verdict in `07-review.md`.
2. Map each blocking issue to a minimal code correction.
3. Apply the code changes.
4. Update or add tests if the review identified missing coverage.
5. Run tests.

## Required Outputs

- Actual code/test modifications.
- Update `06-progress.md` (Add a "Fixes applied" section).
- Update `07-review.md` (Mark the issues as addressed).
- Update `SUMMARY.md`.

## Output Format

Report the following to the Coordinator/User:

### Blocking Issues Addressed

### Reverted / Fixed Files

### Tests Run & Results

### Next recommended skill: `$05-reviewer` (to re-review the fixes)
