import type { Entity } from "../project/schema";
import type { EntityId } from "../shared/types";
import { renderInspectorHtml, renderTreeItemHtml } from "../v2/panelViews";

const entity = makeEntity();
const treeHtml = renderTreeItemHtml(entity, entity.id, "presentation", {});
const inspectorHtml = renderInspectorHtml(entity, "presentation", {});

assert(treeHtml.includes("品红色可视体"), "unbound visual tree label should use human-readable color naming");
assert(!treeHtml.includes("#ff00ff"), "tree label should not expose raw color code");
assert(inspectorHtml.includes("当前可视体"), "inspector should use 可视体 terminology");
assert(!inspectorHtml.includes("表现体"), "inspector should not use old 表现体 terminology");

console.log(JSON.stringify({ status: "passed" }, null, 2));

function makeEntity(): Entity {
  return {
    id: "entity-visual-label" as EntityId,
    internalName: "visual_label",
    displayName: "Label Test",
    kind: "entity",
    persistent: true,
    transform: {
      position: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    render: {
      visible: true,
      color: "#ff00ff",
      opacity: 1,
      layerId: "world",
      size: { x: 64, y: 64 },
      offset: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
      slot: "",
      state: "",
    },
    body: {
      mode: "static",
      velocity: { x: 0, y: 0 },
      gravityScale: 0,
      friction: 0.8,
      bounce: 0,
    },
    collider: {
      shape: "box",
      size: { x: 64, y: 64 },
      offset: { x: 0, y: 0 },
      rotation: 0,
      solid: true,
      trigger: false,
      layerMask: ["world"],
    },
    resources: [],
    tags: [],
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
