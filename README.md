# WebHachimi Engine

WebHachimi is a pure 2D web game editor and runtime workbench. The current main line is a rebuilt v2 TypeScript editor based on the legacy prototype's product direction, not a direct port of its structure.

This workspace is the new main project. `E:\Hachimi\WebHachimi` is the reference implementation and idea source. Legacy files are kept here only as comparison material while the editor is rebuilt and expanded.

## Recommended Run

Use Vite for the v2 editor:

```powershell
npm ci
npm run dev:v2
```

Then open:

```text
http://127.0.0.1:5173/v2.html
```

Use the player entry for runtime-only play:

```powershell
npm run dev:player
```

## Legacy Run

The legacy editor is still available for comparison:

```powershell
npm run serve:legacy
```

Then open:

```text
http://localhost:5577/
```

Legacy direct file mode can still open `index.html`, with browser-local persistence.

## Data Boundary

- v2 editor and player use `/api/v2/project`.
- v2 seed data lives in `data/v2-project.json`; runtime saves go to ignored `data/local/v2-project.json`.
- Legacy editor uses `/api/project`.
- Legacy seed data lives in `data/project.json`; runtime saves go to ignored `data/local/project.json`.

Keep these paths separate. Do not mix legacy project payloads with v2 project payloads.

## Build

```powershell
npm run typecheck
npm run build
npm run verify
```

The production output is written to:

```text
dist-v2/
```

`dist-v2/` is a build artifact and is not source.

## Smoke Checks

Run the full smoke suite through the unified verification entry:

```powershell
npm run verify
```

To run only smoke checks:

```powershell
npm run smoke
```

The smoke suite currently includes:

```powershell
npm run smoke:persistence
npm run smoke:persistence-api
npm run smoke:folder-move
npm run smoke:task-workflow
npm run smoke:autonomy-summary
npm run smoke:viewport
npm run smoke:context-menu
npm run smoke:resource-import
npm run smoke:resource-animation
npm run smoke:canvas-transform
npm run smoke:collision-geometry
npm run smoke:presentation-label
npm run smoke:floating-panels
npm run smoke:runtime-visibility
npm run smoke:performance
npm run smoke:workshops
npm run smoke:transform
npm run smoke:sweep
npm run smoke:autonomy
```

These cover the current rebuild spine: editor persistence and persistence API assembly, user transaction slices, canvas viewport and transform math, context menu/resource workflows, collision geometry, presentation labels, floating panel docking constraints, runtime-only template visibility, a conservative runtime performance budget, gameplay workshops, timing sweep expectations, and autonomous task/test records.

## Toolchain

Use Node.js `24.12.0` and npm `11.x`. The pinned local version lives in `.nvmrc`, and `package.json` declares matching engines. CI installs with `npm ci` and runs `npm run verify`.

## Build Boundary

Development and editor tooling may use Node.js, TypeScript, downloaded assets, and build tools. Exported player builds must be click-to-play and must not require players to install Node.js, TypeScript, package managers, editor dependencies, or local services.

## Important Files

- `v2.html`, `src/v2/*`: current editor main line.
- `player.html`, `src/player/*`: player/runtime entry.
- `src/project/*`: project schema, transactions, diffs, persistence, tasks, and maintenance.
- `src/runtime/*`: runtime world, collision, and timing.
- `src/ai/*`: rule-based task planning and execution loop.
- `src/testing/*`: autonomous testing, timing sweep, telemetry, and smoke checks.
- `index.html`, `styles.css`, `app.js`: legacy single-page editor/runtime kept as rebuild reference.
- `server.js`: local static server plus legacy and v2 project persistence API.
- `data/project.json`: legacy starter project data.
- `data/v2-project.json`: v2 starter project data.
- `WEBHACHIMI_REBUILD_PLAN.md`: rebuild plan for this workspace.

## Rebuild Rule

Use the source project for behavior, product ideas, and implementation evidence. Do not preserve old structure by default. Do not copy `.git/`, `node_modules/`, or `dist-v2/`; install dependencies with `npm ci` and rebuild outputs locally.
