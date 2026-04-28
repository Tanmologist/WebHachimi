# WebTest Feature Inventory

The source at `E:\WebTest` contained a single-page local game workbench. Its migrated features are:

- Canvas scene editor with pan, zoom, selection, dragging, grid, cursor coordinates, FPS badge, and selection outlines.
- Entity templates: box, player, platform, coin, enemy, text, and trigger zone.
- Object list and inspector for transform, color, layer, visibility, locking, body mode, collision flags, controller flags, gravity, collectibles, hazards, speed, jump, and bounce.
- Runtime controls: play, pause, single-step, reset, keyboard movement, gravity, static collision, kinematic enemies, coin collection, and hazard respawn.
- Transactional project store with undo, redo, patch dry-run, patch application, and patch log records.
- Rule-based AI planning panel and quick command input that convert prompts into patch operations.
- AI context export containing scene, selected object, entities, resources, bindings, annotations, and supported patch operations.
- Resource library with typed resources, tags, notes, intent metadata, file attachments, object bindings, scheduled uses, image/material/GIF rendering, and resource-to-entity creation.
- Selected-object resource panel where a character owns resources and each binding has a short purpose such as movement animation.
- Annotation system for scene, entity, and resource notes, including canvas pins, focus, creation, and deletion.
- Floating windows for objects, properties, resources, and annotations, with open/close, minimize, reset, edge resizing, drag-to-edge docking, same-edge split layout, and window manager controls.
- JSON import/export.
- Server-backed persistence through `/api/health`, `/api/project`, `/api/scene`, and `/api/save`, with `localStorage` fallback.
