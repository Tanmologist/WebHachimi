# WebHachimi Roadmap

WebHachimi is moving toward a compact, browser-first 2D game editor and runtime
with strong verification support. The roadmap is organized around maintainable
milestones rather than a fixed release date.

## Current Focus

- Stabilize module boundaries between project, runtime, editor, player, and
  verification code.
- Keep the concrete Hachimi game package playable through both editor handoff
  and static export.
- Improve editor ergonomics for hierarchy, properties, resources, AI tasks, and
  runtime freeze inspection.
- Maintain a fast smoke suite that catches regressions before broad refactors
  land.

## Milestone 1: Editor Foundation

- Canvas pan, zoom, selection, transform, and guide overlays.
- Hierarchy and property panels for common scene objects.
- Resource import, preview, binding, and animation metadata.
- Floating panels with predictable docking and workspace presets.
- Transactional project edits with undo, redo, and rollback evidence.

Status: mostly implemented; ongoing polish and workflow cleanup.

## Milestone 2: Runtime and Game Package

- Fixed-step simulation with dynamic/static collision handling.
- Player, enemy, hazard, pickup, projectile, and combat behaviors.
- Runtime snapshots for freeze/inspect workflows.
- Editor-to-player handoff and player-to-editor freeze handoff.
- Static export for the concrete game package.

Status: implemented enough for smoke coverage and local play; continuing
performance and robustness passes.

## Milestone 3: Verification Workbench

- Scripted runtime test runner.
- Interactive freeze/inspect assertions.
- Reaction-window timing sweeps.
- Autonomous suite records and failure snapshots.
- Export smoke that boots standalone output in Chromium.

Status: active and covered by `npm run smoke`.

## Milestone 4: Maintainer Experience

- Better README, screenshots, architecture docs, and contribution flow.
- Issue and pull request templates.
- Public license and security policy.
- Release checklist and triage workflow.

Status: in progress.

## Milestone 5: Release-Ready Editor

- Clear project loading and save status.
- Better first-run sample flow.
- More stable resource editing and animation preview.
- More polished error states for broken project data.
- Release artifacts with a documented static-hosting path.

Status: planned.

## Deferred

- Collaborative cloud editing.
- Built-in scripting IDE.
- Plugin marketplace.
- Full mobile editor surface.
- Complex 3D workflows.

These are intentionally out of scope until the 2D editor/runtime spine is stable.
