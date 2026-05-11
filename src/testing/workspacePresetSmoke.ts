import { previewWorkspacePresetPlan, type PreviewWorkspacePreset, type PreviewWorkspacePresetPlanEntry } from "../editor/editorShell";

const desktop = { width: 1440, height: 900 };
const compact = { width: 390, height: 720 };

const edit = byId(previewWorkspacePresetPlan("edit", desktop));
assertState(edit, "tools", "open");
assertState(edit, "explorer", "open");
assertState(edit, "editor", "open");
assertState(edit, "workspace", "open");
assertState(edit, "output", "minimized");
assertState(edit, "world-manager", "closed");

const focus = byId(previewWorkspacePresetPlan("focus", desktop));
assertState(focus, "tools", "open");
assertState(focus, "editor", "open");
assertState(focus, "explorer", "minimized");
assertState(focus, "workspace", "minimized");
assertState(focus, "output", "closed");

const ai = byId(previewWorkspacePresetPlan("ai", desktop));
assertState(ai, "workspace", "open");
assertState(ai, "output", "open");
assertState(ai, "explorer", "minimized");

const debug = byId(previewWorkspacePresetPlan("debug", desktop));
assertState(debug, "explorer", "open");
assertState(debug, "workspace", "minimized");
assertState(debug, "output", "open");
assertState(debug, "world-manager", "open");
assertRectInside(debug.get("world-manager"), desktop.width, desktop.height);

const compactDebug = byId(previewWorkspacePresetPlan("debug", compact));
assertRectInside(compactDebug.get("world-manager"), compact.width, compact.height);

console.log(
  JSON.stringify(
    {
      status: "passed",
      presets: ["edit", "focus", "ai", "debug"] satisfies PreviewWorkspacePreset[],
    },
    null,
    2,
  ),
);

function byId(plan: PreviewWorkspacePresetPlanEntry[]): Map<string, PreviewWorkspacePresetPlanEntry> {
  return new Map(plan.map((entry) => [entry.id, entry]));
}

function assertState(plan: Map<string, PreviewWorkspacePresetPlanEntry>, id: string, state: PreviewWorkspacePresetPlanEntry["state"]): void {
  const entry = plan.get(id);
  assert(entry?.state === state, `${id} should be ${state}`);
}

function assertRectInside(entry: PreviewWorkspacePresetPlanEntry | undefined, width: number, height: number): void {
  assert(entry?.rect, `${entry?.id || "window"} should include a rect`);
  assert(entry.rect.left >= 0, "floating rect should stay inside the left edge");
  assert(entry.rect.top >= 0, "floating rect should stay inside the top edge");
  assert(entry.rect.width >= 220, "floating rect should keep a usable width");
  assert(entry.rect.height >= 150, "floating rect should keep a usable height");
  assert(entry.rect.left + entry.rect.width <= width, "floating rect should stay inside the right edge");
  assert(entry.rect.top + entry.rect.height <= height, "floating rect should stay inside the bottom edge");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
