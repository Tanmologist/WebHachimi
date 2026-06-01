# Verification Guide

WebHachimi uses fast TypeScript and smoke checks instead of a single monolithic
test suite.

## Core Commands

```powershell
npm run typecheck
npm run build
npm run smoke
```

`npm run verify` runs typecheck, build, and the smoke suite in sequence.

## Focused Smoke Areas

- persistence and persistence API assembly
- sample project loading
- transaction and folder movement workflows
- task workflow and AI summary models
- keyboard and input mapping
- resource import and animation metadata
- canvas transform and viewport math
- collision geometry
- runtime visibility and performance budgets
- combat action protocol and gameplay workshops
- timing sweep expectations
- autonomous task/test records

## Export Verification

```powershell
npm run smoke:export-game
```

This builds the concrete game, exports a static package, serves it from a
temporary local server, and boots it in Chromium to catch missing assets, local
API dependencies, and startup errors.

## Pages Demo Verification

```powershell
npm run pages:build
npm run pages:verify
```

These commands prepare and verify the same `exports/pages/` directory that the
GitHub Pages workflow uploads as the public static demo.

## Browser Verification

For UI changes, open the relevant local entry in a real browser and confirm:

- the page loads without console errors
- the canvas is visible and nonblank
- panels do not overlap in the default viewport
- keyboard/mouse input still reaches the runtime or editor tool
- save/run/freeze handoff flows still work for the changed area
