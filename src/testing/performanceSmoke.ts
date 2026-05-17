import type { Entity, Scene } from "../project/schema";
import { collectDynamicPairs, collectPairs } from "../runtime/collision";
import { RuntimeWorld } from "../runtime/world";
import type { EntityId, SceneId } from "../shared/types";

type RuntimePerformanceCase = {
  name: string;
  staticCount: number;
  dynamicCount: number;
  ticks: number;
  minTicksPerSecond: number;
};

const runtimeCases: RuntimePerformanceCase[] = [
  { name: "baseline", staticCount: 360, dynamicCount: 1, ticks: 180, minTicksPerSecond: 900 },
  { name: "mixed-density", staticCount: 1000, dynamicCount: 10, ticks: 120, minTicksPerSecond: 300 },
];
const crowdedStaticCount = 80;

const crowdedEntities = createCrowdedCollisionEntities(crowdedStaticCount);
const fullCrowdedPairs = collectPairs(crowdedEntities);
const dynamicCrowdedPairs = collectDynamicPairs(crowdedEntities);
const shapeMixEntities = createShapeMixCollisionEntities(36);
const shapeMixPairs = collectDynamicPairs(shapeMixEntities);
const runtimeResults = runtimeCases.map(runRuntimePerformanceCase);

assert(dynamicCrowdedPairs.length === crowdedStaticCount, `expected ${crowdedStaticCount} dynamic pairs, got ${dynamicCrowdedPairs.length}`);
assert(fullCrowdedPairs.length > dynamicCrowdedPairs.length * 20, "crowded collision fixture should expose static-static pair pruning");
assert(
  dynamicCrowdedPairs.every((hit) => hit.a.body?.mode === "dynamic" || hit.b.body?.mode === "dynamic"),
  "dynamic collision collection should not return static-static pairs",
);
assert(shapeMixPairs.length === 36, `expected 36 shape-mix dynamic pairs, got ${shapeMixPairs.length}`);

console.log(
  JSON.stringify(
    {
      status: "passed",
      runtimeCases: runtimeResults,
      crowdedPairPruning: {
        fullPairs: fullCrowdedPairs.length,
        dynamicPairs: dynamicCrowdedPairs.length,
      },
      shapeMixCollision: {
        entities: shapeMixEntities.length,
        dynamicPairs: shapeMixPairs.length,
      },
    },
    null,
    2,
  ),
);

function runRuntimePerformanceCase(input: RuntimePerformanceCase): Record<string, unknown> {
  const scene = createPerformanceScene(input.staticCount, input.dynamicCount);
  const world = new RuntimeWorld({ scene });
  world.setMode("game");

  const started = performance.now();
  for (let index = 0; index < input.ticks; index += 1) world.runFixedFrame();
  const elapsedMs = performance.now() - started;
  const ticksPerSecond = Math.round((input.ticks * 1000) / Math.max(1, elapsedMs));
  const player = world.entityById("perf-player-0" as EntityId);

  assert(player?.transform.position.y !== undefined, `${input.name}: player should still be simulated`);
  assert(
    ticksPerSecond >= input.minTicksPerSecond,
    `${input.name}: runtime performance smoke too slow: ${ticksPerSecond} ticks/s`,
  );

  return {
    name: input.name,
    staticCount: input.staticCount,
    dynamicCount: input.dynamicCount,
    ticks: input.ticks,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    ticksPerSecond,
    minTicksPerSecond: input.minTicksPerSecond,
    playerY: Math.round(player?.transform.position.y || 0),
  };
}

function createPerformanceScene(staticCount: number, dynamicCount: number): Scene {
  const entities: Record<string, Entity> = {
  };
  for (let index = 0; index < dynamicCount; index += 1) {
    const id = `perf-player-${index}` as EntityId;
    entities[id] = makeEntity(id, index * 72 - 240, -360 - (index % 3) * 18, 42, 64, "dynamic");
  }
  for (let index = 0; index < staticCount; index += 1) {
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
      timeScale: 1,
    },
    entities,
    folders: [],
    layers: [{ id: "world", displayName: "World", order: 0, visible: true, locked: false }],
  };
}

function createShapeMixCollisionEntities(count: number): Entity[] {
  const entities: Entity[] = [makeEntity("perf-shape-player" as EntityId, 0, 0, 64, 64, "dynamic", "circle")];
  for (let index = 0; index < count; index += 1) {
    const entity = makeEntity(`perf-shape-static-${index}` as EntityId, 0, 0, 64, 64, "static", index % 2 === 0 ? "circle" : "polygon");
    if (entity.collider?.shape === "polygon") {
      entity.collider.points = [
        { x: -32, y: -32 },
        { x: 32, y: -24 },
        { x: 28, y: 32 },
        { x: -28, y: 30 },
      ];
    }
    entities.push(entity);
  }
  return entities;
}

function createCrowdedCollisionEntities(count: number): Entity[] {
  const entities: Entity[] = [makeEntity("perf-crowded-player" as EntityId, 0, 0, 64, 64, "dynamic")];
  for (let index = 0; index < count; index += 1) {
    entities.push(makeEntity(`perf-crowded-static-${index}` as EntityId, 0, 0, 64, 64, "static"));
  }
  return entities;
}

function makeEntity(
  id: EntityId,
  x: number,
  y: number,
  width: number,
  height: number,
  mode: "dynamic" | "static",
  shape: "box" | "circle" | "polygon" = "box",
): Entity {
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
      shape,
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
