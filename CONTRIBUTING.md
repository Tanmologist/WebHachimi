# Contributing to WebHachimi

Thanks for helping improve WebHachimi. The project is early-stage and moves
quickly, so small focused changes are easiest to review.

## Development Setup

```powershell
npm ci
npm run dev:editor
```

Use Node.js `24.12.0` and npm `11.x`; `.nvmrc` and `package.json` define the
expected versions.

## Verification

Before opening a pull request, run the narrowest relevant checks for your change.
For broad editor/runtime changes, run:

```powershell
npm run typecheck
npm run build
npm run smoke
```

Use `npm run verify` when you want the full typecheck, build, and smoke sweep in
one command.

## Pull Requests

- Keep PRs focused on one feature, fix, or refactor.
- Prefer existing module boundaries: `project`, `runtime`, `editor`, `player`,
  `verification`, and `testing`.
- Include the commands you ran and any known remaining risk.
- Avoid committing generated build output such as `dist-v2/`, `exports/`,
  `node_modules/`, local saves, or logs.

## Issue Reports

Helpful bug reports include:

- Which entry was used: editor, player, or static export.
- Browser and OS.
- Reproduction steps.
- Expected and actual behavior.
- Console errors, screenshots, or failing smoke command output when available.
