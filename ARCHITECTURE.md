# WebHachimi Architecture

WebHachimi is split into small ownership areas so editor work, runtime
simulation, verification, and concrete game packages can evolve independently.
The project is still early-stage, but the current architecture is intentionally
modular and testable.

## Core Layers

### Project

`src/project` owns persisted project data and all durable state transitions:

- schema and normalization
- transactions, patches, diffs, undo/redo, and rollback
- project persistence and handoff records
- task records, runtime snapshots, and maintenance metadata
- resource animation metadata shared by editor and player

Project code should not depend on runtime or editor implementation details.

### Runtime

`src/runtime` owns deterministic game simulation for a single scene:

- fixed-step clock
- entity store and mutable runtime state
- collision pair collection and runtime collision response
- freeze/resume snapshots
- editor/game handoff bridge

Runtime code can consume project entities and combat definitions, but rendering
and browser input binding live outside this layer.

### Editor

`src/editor` owns the desktop editing surface:

- panel and floating-window layout
- canvas transforms and selection
- resource import and binding workflows
- task panels, summaries, super brush, and editor-specific controllers

The editor should write through project transactions instead of mutating durable
project state directly.

### Player

`src/player` owns the playable browser entry:

- keyboard and pointer input adapters
- Pixi rendering for live gameplay
- player-side project loading and runtime handoff consumption

Shared input mapping lives in `src/shared/playerInput.ts` so editor tools do not
depend on player internals.

### Verification

`src/verification` owns reusable verification services:

- scripted runtime test runner
- interactive freeze/inspect runner
- timing sweep and reaction-window checks
- project-level verification checks
- telemetry and autonomous suite orchestration

`src/testing` contains smoke-test entry points and compatibility exports. This
keeps reusable verification code separate from one-off test scripts.

### Concrete Games

Concrete game packages live under `games/*`. They supply:

- HTML entry metadata
- seed project JSON
- game resources
- optional package-specific editor entry

The generic editor should not hard-code a concrete game package.

## Data Flow

1. The editor or AI task system creates a transaction.
2. The project layer applies or dry-runs patches and records diffs.
3. The runtime consumes normalized project scenes and produces runtime snapshots.
4. Verification runners execute scripts, freeze key frames, and write test
   records or failure snapshots back to the project.
5. Static export embeds the project into a player page so the game can run
   without the local project API.

## Design Rules

- Keep project data serializable and diffable.
- Keep gameplay speed independent of frame rate.
- Keep editor UI, rendering, input binding, and simulation in separate modules.
- Add shared helpers only when multiple layers genuinely need the same concept.
- Preserve compatibility exports when moving public helpers between modules.
- Verification should be narrow first, then broaden when shared behavior changes.

## Important Entry Points

- `apps/webhachimi/editor.html`: generic editor shell.
- `games/hachimi-nanbei-lvdong/editor.html`: game-specific editor shell.
- `games/hachimi-nanbei-lvdong/index.html`: playable game entry.
- `src/runtime/world.ts`: fixed-step world simulation.
- `src/project/schema.ts`: persisted project model.
- `src/verification/autonomousTesting.ts`: autonomous verification suite.
- `scripts/export-static-game.cjs`: standalone static export pipeline.
