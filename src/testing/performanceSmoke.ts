import type { Entity, Scene } from "../project/schema";
import { collectDynamicPairs, collectPairs } from "../runtime/collision";
import { RuntimeWorld } from "../runtime/world";
import type { EntityId, SceneId } from "../shared/types";

const staticCount = 360;
const crowdedStaticCount = 80;
const ticks = 180;
const scene = createPerformanceScene(staticCount);
const world = new RuntimeWorld({ scene });
world.setMode("game");
const crowdedEntities = createCrowdedCollisionEntities(crowdedStaticCount);
const fullCrowdedPairs = collectPairs(crowdedEntities);
const dynamicCrowdedPairs = collectDynamicPairs(crowdedEntities);

const started = performance.now();
for (let index = 0; index < ticks; index += 1) world.runFixedFrame();
const elapsedMs = performance.now() - started;
const ticksPerSecond = Math.round((ticks * 1000) / Math.max(1, elapsedMs));
const player = world.entityById("perf-player" as EntityId);

assert(player?.transform.position.y !== undefined, "player should still be simulated");
assert(ticksPerSecond >= 900, `runtime performance smoke too slow: ${ticksPerSecond} ticks/s`);
assert(dynamicCrowdedPairs.length === crowdedStaticCount, `expected ${crowdedStaticCount} dynamic pairs, got ${dynamicCrowdedPairs.length}`);
assert(fullCrowdedPairs.length > dynamicCrowdedPairs.length * 20, "crowded collision fixture should expose static-static pair pruning");
assert(
  dynamicCrowdedPairs.every((hit) => hit.a.body?.mode === "dynamic" || hit.b.body?.mode === "dynamic"),
  "dynamic collision collection should not return static-static pairs",
);

console.log(
  JSON.stringify(
    {
      status: "passed",
      staticCount,
      ticks,
      elapsedMs: Number(elapsedMs.toFixed(2)),
      ticksPerSecond,
      crowdedPairPruning: {
        fullPairs: fullCrowdedPairs.length,
        dynamicPairs: dynamicCrowdedPairs.length,
      },
      playerY: Math.round(player?.transform.position.y || 0),
    },
    null,
    2,
  ),
);

function createPerformanceScene(count: number): Scene {
  const entities: Record<string, Entity> = {
    "perf-player": makeEntity("perf-player" as EntityId, 0, -360, 42, 64, "dynamic"),
  };
  for (let index = 0; index < count; index += 1) {
    const id = `perf-static-${index}` as EntityId;
    const column = index % 40;
    const row = Math.floor(index / 40);
    entities[id] = makeEntity(id, column * 90 - 1800, row * 80 - 120, 64, 18, "static");
  }
  entities.floor = makeEntity("floor" as EntityId, 0, 180, 4200, 44, "static");
  return {
    id: "scene-performance" as SceneId,
    name: "Performance Smoke",
    settings: {
      width: 4200,
      height: 1600,
      background: "#101211",
      gravity: { x: 0, y: 1400 },
      tickRate: 100,
      fixedStepMs: 10,
    },
    entities,
    folders: [],
    layers: [{ id: "world", displayName: "World", order: 0, visible: true, locked: false }],
  };
}

function createCrowdedCollisionEntities(count: number): Entity[] {
  const entities: Entity[] = [makeEntity("perf-crowded-player" as EntityId, 0, 0, 64, 64, "dynamic")];
  for (let index = 0; index < count; index += 1) {
    entities.push(makeEntity(`perf-crowded-static-${index}` as EntityId, 0, 0, 64, 64, "static"));
  }
  return entities;
}

function makeEntity(id: EntityId, x: number, y: number, width: number, height: number, mode: "dynamic" | "static"): Entity {
  return {
    id,
    internalName: id,
    displayName: id,
    kind: "entity",
    persistent: true,
    transform: {
      position: { x, y },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    render: {
      visible: true,
      color: mode === "dynamic" ? "#77b8df" : "#3a423f",
      opacity: 1,
      layerId: "world",
      size: { x: width, y: height },
    },
    body: {
      mode,
      velocity: { x: mode === "dynamic" ? 120 : 0, y: 0 },
      gravityScale: mode === "dynamic" ? 1 : 0,
      friction: 0.8,
      bounce: 0,
    },
    collider: {
      shape: "box",
      size: { x: width, y: height },
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
