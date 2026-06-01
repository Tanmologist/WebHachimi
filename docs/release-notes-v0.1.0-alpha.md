# WebHachimi v0.1.0-alpha

Release date: 2026-06-01

This alpha release packages WebHachimi as a public, reviewable browser game
editor project rather than a loose local experiment.

## Highlights

- MIT-licensed TypeScript/Pixi editor and 2D runtime.
- Concrete Hachimi Nanbei Lvdong game package for editor/runtime testing.
- Static game export path that embeds project data and runs without the local
  project API.
- GitHub Pages workflow for publishing the static player demo.
- CI verification with typecheck, build, smoke checks, and Playwright Chromium.
- README, architecture, maintainer, editor, verification, security,
  contributing, changelog, issue template, and pull request template docs.

## Verification

Use these checks for this release line:

```powershell
npm run typecheck
npm run build
npm run smoke
npm run smoke:export-game
```
