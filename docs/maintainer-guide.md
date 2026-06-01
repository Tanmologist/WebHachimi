# Maintainer Guide

This guide captures the current maintenance loop for WebHachimi.

## Daily Development

```powershell
npm ci
npm run dev:editor
```

Use `npm run dev:game:editor` when working against the concrete Hachimi game
package, and `npm run dev:game` when testing the player entry.

## Change Review

For small UI or documentation changes:

```powershell
npm run typecheck
```

For runtime, verification, project schema, or export changes:

```powershell
npm run typecheck
npm run build
npm run smoke
```

For static export changes:

```powershell
npm run smoke:export-game
```

For the public Pages demo:

```powershell
npm run pages:build
npm run pages:verify
```

## Release Checklist

1. Confirm the default branch is green in CI.
2. Run `npm run verify` locally for broad changes.
3. Run `npm run smoke:export-game` when export behavior changed.
4. Update README or docs if user-facing workflows changed.
5. Run `npm run pages:build` and `npm run pages:verify` for demo-affecting
   changes.
6. Tag the release or create a GitHub release with the verification summary.
7. Confirm the Pages Demo workflow published the expected static artifact.

## Triage Priorities

1. Data loss, broken saves, or failed project loading.
2. Player/runtime regressions.
3. Static export regressions.
4. Editor workflow blockers.
5. Documentation and onboarding gaps.

## Maintainer Notes

- Prefer small, reviewable pull requests.
- Keep generated output out of git.
- Keep editor, runtime, project, player, and verification boundaries explicit.
- Preserve compatibility exports when moving helpers that downstream code may
  import.
