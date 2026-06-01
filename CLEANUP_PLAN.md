# Cleanup Plan

This repository still contains legacy reference material from the original
prototype while the TypeScript/Pixi rebuild matures. The goal is to keep useful
evidence without letting old files confuse contributors.

## Current Policy

- Do not delete legacy material until an equivalent v2 path is documented and
  covered by smoke checks.
- Keep generated artifacts ignored by git.
- Prefer archiving old reference files under a clearly named folder before
  deleting them.
- Keep README and docs focused on the current TypeScript project.

## Retained Reference Files

- `index.html`, `styles.css`, `app.js`: legacy single-page prototype.
- `data/project.json`: legacy seed data used for comparison and migration.
- `FEATURES.md`, `ENGINE_LOGIC_NOTES.md`: feature inventory and behavior notes.
- `editor-preview.html`, `editor-preview.css`: static UI reference material.

## Ignored Generated Output

- `node_modules/`
- `dist-v2/`
- `dist-webhachimi/`
- `dist-hachimi-nanbei-lvdong/`
- `exports/`
- `logs/`
- local project saves under `data/local/` and `games/*/local/`

## Archive Candidates

Move these into `archive/legacy-app/` once the v2 editor has stable replacement
coverage and the smoke suite still passes:

- `index.html`
- `styles.css`
- `app.js`
- `data/project.json`
- `editor-preview.html`
- `editor-preview.css`

## Before Removing Files

1. Confirm no active source, test, script, or document references the file.
2. Run `npm run typecheck`.
3. Run the relevant smoke command, or `npm run smoke` for broad cleanup.
4. Record the reason in the pull request or commit body.
