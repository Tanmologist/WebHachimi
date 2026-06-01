# Editor Guide

WebHachimi's editor is a desktop-focused browser workbench for building and
debugging 2D game scenes.

## Main Areas

- **Toolbar**: selection, primitive tools, super brush, and play preview.
- **Hierarchy**: scene groups, entity visibility, body labels, and selection.
- **World canvas**: grid, pan/zoom, object selection, guides, and runtime freeze
  inspection.
- **Properties**: transform, presentation, physics, persistence, and behavior
  parameters for the selected object.
- **AI tasks**: task context, generated summaries, and maintenance notes.
- **Resources**: object-bound assets, imported files, and animation metadata.
- **Log panel**: lightweight runtime/editor status output.

## Typical Workflow

1. Open the game editor entry:

   ```powershell
   npm run dev:game:editor
   ```

2. Select an entity in the hierarchy or canvas.
3. Edit properties or resource bindings.
4. Use play preview to run the scene.
5. Freeze back into editor mode to inspect the current runtime state.
6. Run focused smoke checks before committing.

## Runtime Handoff

The editor and player exchange state through an explicit handoff flow. Runtime
snapshots are preserved when entering editor mode so temporary combat objects,
velocity, timers, cooldowns, and animation state can be inspected without
resetting the scene.

## Static Export

The concrete game can be exported as a standalone static package:

```powershell
npm run export:game
```

The export embeds project data and copies referenced resources so the output can
be served without the local project API.
