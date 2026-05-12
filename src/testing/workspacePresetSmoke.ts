import { previewWorkspacePresetPlan, type PreviewWorkspacePreset, type PreviewWorkspacePresetPlanEntry } from "../editor/editorShell";

const desktop = { width: 1440, height: 900 };
const compact = { width: 390, height: 720 };

const edit = byId(previewWorkspacePresetPlan("edit", desktop));
assertState(edit, "tools", "open");
assertState(edit, "explorer", "open");
assertState(edit, "editor", "open");
assertState(edit, "workspace", "open");
assertState(edit, "output", "minimized");
assertMissing(edit, "world-manager");

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
assertMissing(debug, "world-manager");

const compactDebug = byId(previewWorkspacePresetPlan("debug", compact));
assertMissing(compactDebug, "world-manager");

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

function assertMissing(plan: Map<string, PreviewWorkspacePresetPlanEntry>, id: string): void {
  assert(!plan.has(id), `${id} should not be managed as a window`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
