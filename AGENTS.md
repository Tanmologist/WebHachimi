# WebHachimi — AI Agent Guide

> This document is written for AI assistants (Copilot, Claude, GPT-4, Gemini, etc.) that need to work with the WebHachimi codebase. Read this before making any changes.

---

## What Is WebHachimi?

WebHachimi is a **spatial-prompt game prototyping tool**. Users draw geometric shapes on a 2D canvas and attach task memos to them. AI agents read the spatial layout (positions, sizes, roles, annotations, sketches) and translate the canvas into real game logic, UI components, or behaviors.

The core concept: **human and AI share the same spatial canvas** as a two-way interface for game prototyping.

---

## Setup & Running

### Requirements
- Node.js v18+
- npm (for `ws` WebSocket package)

### First-time setup
```bash
cd /path/to/WebHachimi
npm install          # installs ws (WebSocket library)
```

### Start the server
```bash
node server.js       # or double-click start.bat on Windows
# Opens http://localhost:5577 automatically
```

### Environment variables
- `WEBHACHIMI_PORT` — override port (default 5577)
- `WEBHACHIMI_NO_BROWSER` — set to `1` to suppress auto-open browser

---

## Architecture Overview

### Tech Stack
- **Zero dependencies** in the browser — pure HTML/CSS/JavaScript
- **Module pattern**: each file is an IIFE that attaches one global: `(function(global){...})(window)`
- **Server**: Node.js HTTP + WebSocket (ws package), only listens on 127.0.0.1

### Script Loading Order (index.html)
```
consolePanel.js   ← loads FIRST to catch early errors
state.js          ← data center (State)
engine.js         ← math, viewport, DOM renderer (Engine)
dragController.js ← drag/resize/rotate interaction
taskPanel.js      ← task/memo UI panel
propertyPanel.js  ← property form
worldTree.js      ← hierarchical object tree panel
taskManager.js    ← global task aggregator
sketchTool.js     ← super-sketch drawing tool
canvasSnapshot.js ← canvas export to PNG/SVG
sceneIO.js        ← scene import/export
serverSync.js     ← bidirectional server sync
editor.js         ← mode switching, context menu, top-level render
audioEngine.js    ← audio playback pool (AudioEngine)
networkEngine.js  ← WebSocket client (NetworkEngine)
sceneManager.js   ← multi-scene / level transitions (SceneManager)
game.js           ← game loop, physics, input (Game)
aiEngine.js       ← in-browser LLM integration (AIEngine)
app.js            ← bootstrap: wire everything together
```

---

## Coordinate System

```
(0,0) ──────────────── +X →
  │
  │   Player spawns around y = -80
  │   Main floor: y = 40, height = 60  (top surface at y=40)
  │
 +Y   Stone sitting on floor: stone.y = 40 - stone.height
 ↓    Below-floor terrain: y > 100
```

- **X right = positive**, **Y down = positive**
- Object positions are **top-left corners**
- View transform: `world.style.transform = translate(vx, vy) scale(s)`
- `State.state.view` stores `{x, y, scale}`

---

## Core Data Model

### Scene Object (`shape`)
```javascript
{
  id: "shape-1",          // unique, format "shape-N"
  type: "square",         // "square" | "circle" | "triangle" | "pen" | "brush"
  name: "主角",           // display name
  role: "player",         // "player" | "floor" | "hitbox" | "generic"
  x: 80,   y: -80,        // top-left world position
  width: 80, height: 80,  // size in world units
  fill: "#16a34a",        // background color (#hex)
  stroke: "#1f2937",      // border color
  strokeWidth: 1,         // border width (px)
  opacity: 1,             // 0–1
  pivotX: 0.5, pivotY: 0.5,  // pivot point (0–1)
  rotation: 0,            // degrees
  tasks: [],              // local task memos (TaskObject[])
  parentId: null,         // parent shape id (for hitboxes)
  isHitbox: false,        // true = auto-expires via lifetime
  lifetime: 0,            // seconds until auto-delete (hitboxes)
  points: null,           // polygon points for pen/brush shapes

  // ── Visual extensions ──
  sprite: null,           // URL or dataUrl for image/GIF background
  spriteFit: "cover",     // "cover" | "contain" | "fill" | "none"
  text: null,             // text content displayed inside the shape

  // ── Sprite sheet animation ──
  spriteSheet: null,      // URL to horizontal sprite sheet image
  frameCount: 1,          // number of frames (horizontal layout)
  frameWidth: 80,         // pixel width of ONE frame
  frameHeight: 80,        // pixel height of ONE frame
  fps: 8,                 // frames per second
  // _spriteFrame, _spriteTime are runtime state (not persisted)
}
```

### Global Task
```javascript
{
  id: "task-1",
  path: "1",             // display path string (e.g., "1.2.3")
  text: "Add terrain",   // task description
  done: false,
  attachments: [         // files/images/sketches attached to this task
    {
      id: "att-1",
      name: "sketch.json",
      mime: "application/x-super-sketch+json",
      size: 1234,
      dataUrl: "data:application/json;base64,...",
    }
  ]
}
```

### Super-Sketch Format (attachment)
When `mime === "application/x-super-sketch+json"`, decode `dataUrl` base64 to get:
```javascript
{
  kind: "super-sketch",
  bounds: { x: 95, y: 130, w: 565, h: 165 },  // world-coordinate bounding box
  strokes: [
    { points: [{ x: 123, y: 153 }, { x: 99, y: 241 }, ...] }  // world coordinates
  ]
}
```
**Stroke coordinates are world coordinates**, same system as object positions.

---

## State API (`window.State`)

```javascript
State.state                      // raw state object
State.state.objects              // Shape[]
State.state.globalTasks          // GlobalTask[]
State.state.nextId               // next shape ID counter
State.state.nextTaskId           // next task ID counter
State.state.editMode             // boolean: edit vs play mode
State.state.view                 // {x, y, scale}

// Shape helpers
State.normalizeShape(raw, index) // create normalized shape from plain object
State.generateShapeId()          // → "shape-N" (auto-increments nextId)
State.generateTaskId()           // → "task-N"
State.getShapeWidth(shape)       // safe width accessor
State.getShapeHeight(shape)      // safe height accessor
State.getObjectById(id)          // → shape | null
State.getObjectsByRole(role)     // → shape[]
State.getFirstObjectByRole(role) // → shape | null

// Persistence
State.captureBaseline()          // snapshot non-hitbox objects as baseline
State.persistState()             // save to localStorage + trigger ServerSync
State.exportSceneJSON()          // → JSON string (for file export)
State.serializeForAI()           // → AI-friendly snapshot (no hitboxes)

// Undo
State.recordUndo(label)
State.undo()                     // → label | null
```

### How to add/remove objects (from AI injected code)

```javascript
// ADD
const obj = State.normalizeShape({
  id: State.generateShapeId(),
  type: 'square', name: 'Platform',
  role: 'floor', x: 100, y: 200, width: 200, height: 20,
  fill: '#1d4ed8', stroke: '#1f2937', strokeWidth: 1,
  opacity: 1, pivotX: 0.5, pivotY: 0.5, rotation: 0,
  tasks: [], parentId: null, isHitbox: false, lifetime: 0, points: null,
}, State.state.objects.length);
State.state.objects.push(obj);
State.captureBaseline();
State.persistState();
Editor.render();

// REMOVE
State.state.objects = State.state.objects.filter(o => o.id !== 'shape-5');
State.captureBaseline();
State.persistState();
Editor.render();
```

---

## Game Engine API (`window.Game`)

```javascript
Game.clock              // { time: number, paused: bool }
Game.gameTime()         // current game clock (seconds, stops when paused)
Game.setPaused(bool)    // pause/resume game loop
Game.isPaused()         // boolean
Game.start()            // start the animation loop
Game.gravity            // physics config object (see below)

// Behavior injection (AI-usable)
Game.addUpdateHook(name, fn)     // fn(dt, state) called every frame
Game.removeUpdateHook(name)      // remove a hook by name

// Gravity system (optional, default OFF)
Game.enableGravity(true)         // enable gravity + Space-to-jump
Game.enableGravity(false)        // disable
Game.isGravityEnabled()          // boolean
Game.gravity.g           = 700   // acceleration (px/s²)
Game.gravity.jumpForce   = 560   // jump initial velocity (upward)
Game.gravity.maxFall     = 1200  // terminal velocity
```

### Example: add an enemy patrol behavior
```javascript
Game.addUpdateHook('enemy-patrol', function(dt, state) {
  const enemy = state.objects.find(o => o.name === '敌人');
  if (!enemy) return;
  enemy._patrolDir = enemy._patrolDir || 1;
  enemy.x += 80 * enemy._patrolDir * dt;
  if (enemy.x > 400) enemy._patrolDir = -1;
  if (enemy.x < 100) enemy._patrolDir = 1;
});
```

### Example: enable gravity at game start
```javascript
Game.enableGravity(true);
Game.gravity.g = 500;  // lower gravity
```

---

## Visual Capabilities

### Static Image / GIF on a shape
```javascript
// Set sprite field — engine renders it as background-image
State.state.objects.find(o => o.name === 'Player').sprite = 'https://example.com/player.png';
// GIF plays automatically in browser
State.state.objects.find(o => o.name === 'Explosion').sprite = '/assets/explosion.gif';
```

### Text content inside a shape
```javascript
shape.text = 'Hello World';   // rendered as centered div inside the shape node
shape.fill = '#1f2937';       // dark background for readability
```

### Animated Sprite Sheet (horizontal layout)
```javascript
// Sprite sheet: single image with N frames side by side horizontally
shape.spriteSheet = '/assets/walk.png';
shape.frameCount  = 8;      // 8 frames
shape.frameWidth  = 64;     // each frame is 64px wide
shape.frameHeight = 64;     // each frame is 64px tall
shape.fps         = 12;     // 12 frames per second
// The game loop automatically cycles background-position each frame
```

---

## Audio API (`window.AudioEngine`)

```javascript
AudioEngine.play(url, volume, loop)   // play audio file (URL or dataUrl)
AudioEngine.stop(url)                 // stop and reset
AudioEngine.pause(url)                // pause
AudioEngine.stopAll()                 // stop all audio
AudioEngine.setVolume(url, 0.5)       // set volume 0–1
AudioEngine.isPlaying(url)            // → boolean
```

Example (via AI injectCode):
```javascript
AudioEngine.play('/assets/jump.wav', 0.8);
AudioEngine.play('/assets/bg-music.mp3', 0.4, true);  // loop background
```

---

## Network API (`window.NetworkEngine`)

WebSocket connects to the same server on ws://localhost:5577.
```javascript
NetworkEngine.connect()              // connect (default: current host)
NetworkEngine.disconnect()           // disconnect
NetworkEngine.isConnected()          // boolean
NetworkEngine.send({ type: 'move', x: 100, y: 200 })
NetworkEngine.broadcast('player-state', { x, y, hp })
NetworkEngine.onMessage(function(data) {
  if (data.type === 'player-state') { /* handle remote player */ }
  return /* cleanup fn */;
});
NetworkEngine.onOpen(function() { console.log('connected'); });
```

**Note**: Messages are broadcast to ALL other connected clients. Sender does not receive its own messages.

---

## Scene Manager (`window.SceneManager`)

Multiple scene files: `scene.json` (default) + `scene-level2.json`, `scene-boss.json`, etc.

```javascript
// List available scenes
const scenes = await SceneManager.listScenes();
// → [{ id: "default", file: "scene.json" }, { id: "level2", file: "scene-level2.json" }]

// Load a scene (with fade transition)
await SceneManager.loadScene('level2');

// Save current state as a named scene
await SceneManager.saveCurrentScene('level2');

// Instant scene switch from in-memory object (no server roundtrip)
await SceneManager.applyScene(mySceneObject, { fade: false });

SceneManager.currentId  // current scene id string
```

---

## AI Engine (`window.AIEngine`)

Built-in LLM integration. Reads scene + task + sketch, calls LLM, applies structured actions.

### Configuration (stored in localStorage)
```javascript
AIEngine.setApiKey('sk-...')
AIEngine.setEndpoint('https://api.openai.com/v1/chat/completions')  // default
AIEngine.setModel('gpt-4o')  // default
```

### Execute a task programmatically
```javascript
const task = State.state.globalTasks.find(t => t.id === 'task-1');
await AIEngine.executeTask(task);
```

### LLM Response Format (JSON)
```json
{
  "explanation": "Chinese explanation of what I'm doing and why",
  "actions": [
    { "type": "addObject", "object": { ...shape fields... } },
    { "type": "modifyObject", "id": "shape-3", "changes": { "fill": "#ef4444" } },
    { "type": "removeObject", "id": "shape-5" },
    { "type": "injectCode", "name": "patrol-hook", "code": "Game.addUpdateHook('patrol', ...)" },
    { "type": "markTaskDone", "taskId": "task-1" }
  ]
}
```

---

## Server API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check `{ok, server, port}` |
| GET | `/api/scene` | Load default `scene.json` |
| GET | `/api/scenes` | List all `scene-*.json` files |
| GET | `/api/scene/:id` | Load `scene-<id>.json` |
| POST | `/api/scene/:id/save` | Save to `scene-<id>.json` |
| POST | `/api/save` | Save current scene (splits attachments to `assets/`) |
| POST | `/api/activate-task` | Write task to `active-task.json` |
| POST | `/api/inject-objects` | Merge objects into scene without restart |
| POST | `/api/log` | Append to `console-log.json` |
| GET | `/api/console-log` | Read `console-log.json` |
| WS | `ws://localhost:PORT` | WebSocket broadcast bus |

---

## Common Patterns

### Pattern: Place objects based on sketch coordinates
1. Find the task's super-sketch attachment
2. Decode: `const sketch = JSON.parse(atob(att.dataUrl.split(',')[1]))`
3. Use `sketch.bounds` for overall region, `sketch.strokes[0].points` for exact profile
4. Place shapes matching the sketch geometry (walls follow outer edges, platforms at mid-heights)

### Pattern: Add a floor that player can walk on
```javascript
State.state.objects.push(State.normalizeShape({
  id: State.generateShapeId(), type: 'square', name: 'Platform',
  role: 'floor',  // ← must be 'floor' for collision
  x: 100, y: 300, width: 400, height: 20,
  fill: '#1d4ed8', stroke: '#1f2937', strokeWidth: 1,
  opacity: 1, pivotX: 0.5, pivotY: 0.5, rotation: 0,
  tasks: [], parentId: null, isHitbox: false, lifetime: 0, points: null,
}, State.state.objects.length));
State.captureBaseline();
State.persistState();
Editor.render();
```

### Pattern: Add enemy with patrol AI
```javascript
// 1. Add enemy object
State.state.objects.push(State.normalizeShape({...role:'generic'...}, ...));
State.captureBaseline(); State.persistState(); Editor.render();

// 2. Inject patrol behavior
Game.addUpdateHook('enemy-patrol', function(dt) {
  const e = State.state.objects.find(o => o.name === 'Enemy');
  if (!e) return;
  e._dir = e._dir || 1;
  e.x += 120 * e._dir * dt;
  if (e.x > 500 || e.x < 100) e._dir *= -1;
});
```

### Pattern: Enable platformer mode (gravity + jump)
```javascript
Game.enableGravity(true);
// Player can now fall down. Press Space to jump when grounded.
// W key still moves up (for non-platformer mode).
// W becomes disabled when gravity is on — use Space for jumping.
```

### Pattern: Multi-scene level transition
```javascript
// Save current scene
await SceneManager.saveCurrentScene('level1');

// Load next level
await SceneManager.loadScene('level2');  // fades out, loads, fades in
```

---

## Pitfalls & Notes

1. **PowerShell encoding**: Always use `[System.IO.File]::WriteAllText(path, content, [System.Text.Encoding]::UTF8)` or `node` scripts to write JSON files. `Set-Content` uses GBK by default and corrupts Chinese characters.

2. **Browser auto-save**: The browser POSTs to `/api/save` every ~600ms when ServerSync is active. Direct edits to `scene.json` on disk will be overwritten. To inject objects while the server is running, use `POST /api/inject-objects`.

3. **nextId counter**: After adding objects programmatically, ensure `State.state.nextId` is set to `max(existing_shape_numbers) + 1`. Calling `State.captureBaseline()` then `State.persistState()` will save it.

4. **hitbox vs floor role**: Objects with `role: 'hitbox'` are treated as attack hitboxes (expire via `lifetime`). Objects with `role: 'floor'` block movement. Never confuse them.

5. **No gravity by default**: The game has no gravity unless `Game.enableGravity(true)` is called. Player moves freely in 2D with WASD.

6. **Sketch coordinates = world coordinates**: The super-sketch `strokes[].points` are in the same world coordinate space as object `{x, y}`. Use them directly for placement.

7. **GIF and static images**: Set `shape.sprite = 'url'` — the engine renders it as `background-image`. GIFs animate automatically in the browser. No extra code needed.

8. **WebSocket requires ws package**: Run `npm install` in the project root before starting the server. The server gracefully degrades (no WebSocket) if `ws` is not installed.

---

## File Structure

```
WebHachimi/
├── index.html          # main page (no build step)
├── styles.css          # all styles
├── state.js            # data model (State)
├── engine.js           # rendering + coordinate math (Engine)
├── dragController.js   # drag/resize/rotate interaction
├── taskPanel.js        # task panel UI
├── propertyPanel.js    # property panel UI
├── worldTree.js        # world tree panel
├── taskManager.js      # task aggregator panel
├── sketchTool.js       # super-sketch drawing
├── canvasSnapshot.js   # canvas → PNG/SVG
├── sceneIO.js          # import/export scene JSON
├── serverSync.js       # bidirectional sync with server
├── editor.js           # edit mode coordinator
├── audioEngine.js      # AudioEngine: play/stop sounds
├── networkEngine.js    # NetworkEngine: WebSocket client
├── sceneManager.js     # SceneManager: multi-scene transitions
├── game.js             # Game: loop, physics, input, hooks
├── aiEngine.js         # AIEngine: in-browser LLM integration
├── app.js              # bootstrap
├── consolePanel.js     # error/log capture panel
├── server.js           # Node.js HTTP + WebSocket server
├── scene.json          # default scene (auto-saved)
├── scene-<id>.json     # additional scene files
├── assets/             # attachments (images, sketches, etc.)
├── package.json        # npm config (ws dependency)
├── start.bat           # Windows quick-launch
└── AGENTS.md           # this file
```
