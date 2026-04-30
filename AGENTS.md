# Project AGENTS

## Feature-Based Git Commits

- Commit by completed work unit, not by elapsed time.
- Create a git commit after each coherent small feature, large feature, bug fix, optimization, documentation update, or verified milestone.
- Do not create a commit merely because a time interval has passed.
- If a work unit is still incomplete, keep working until it reaches a safe checkpoint before committing.
- Before committing, inspect `git status --short` and a diff summary.
- Never discard, reset, or revert user changes to make a commit cleaner.
- Stage only the intended project changes for the current work. If unrelated user edits are present and cannot be safely separated, ask before committing.
- Commit messages must be in Chinese.
- Use a short title that names the main change.
- Add a commit body with 2-5 bullet points that records the completed work unit and roughly explains what changed.
- Mention important verification in the commit body when tests, typecheck, build, smoke checks, or browser checks were run.
- Do not push unless the user explicitly asks.
