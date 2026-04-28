# WebHachimi v2 Source Layout

`src` is the new engine/editor skeleton. The legacy single-file app remains in
`app.js` while the rewrite is built module by module.

## Boundaries

- `runtime`: pure 2D game execution, fixed stepping, freezing, collisions.
- `project`: persisted project state, patches, transactions, rollback.
- `editor`: desktop-only editing concepts such as selection and super brush.
- `ai`: task execution and simulation testing orchestration.
- `shared`: IDs, geometry, result helpers, and cross-layer types.

The editor and AI layers must not mutate runtime or project state directly.
Persistent changes go through transactions.

## Super Brush Task Flow

- Drafts carry strokes, annotations, selected targets, and an optional snapshot id.
- Creating a super-brush task requires a non-empty task description.
- Task cards can render a compact preview from persisted stroke and annotation data.
