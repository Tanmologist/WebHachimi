import { createStarterProject } from "../editor/starterProject";
import { formatWorldSpeed, parseWorldSpeedInput } from "../editor/worldSpeedControl";
import { normalizeProjectDefaults, normalizeSceneTimeScale } from "../project/schema";
import { RuntimeWorld } from "../runtime/world";

const project = normalizeProjectDefaults(createStarterProject());
const scene = project.scenes[project.activeSceneId];
assert(scene.settings.timeScale === 1, `expected default world speed 1, got ${scene.settings.timeScale}`);
assert(normalizeSceneTimeScale(Number.POSITIVE_INFINITY) === 1, "invalid world speed should normalize to 1");
assert(normalizeSceneTimeScale(-2) === 0, "negative world speed should clamp to 0");
assert(normalizeSceneTimeScale(9) === 4, "world speed should clamp to 4x");
assert(parseWorldSpeedInput("") === undefined, "empty editor speed input should be rejected");
assert(parseWorldSpeedInput("bad") === undefined, "non-numeric editor speed input should be rejected");
assert(parseWorldSpeedInput("-2") === 0, "editor speed input should clamp negative values");
assert(parseWorldSpeedInput("9") === 4, "editor speed input should clamp high values");
assert(formatWorldSpeed(1) === "1x", "integer speed label should omit decimals");
assert(formatWorldSpeed(0.5) === "0.5x", "single decimal speed label should trim trailing zero");

scene.settings.timeScale = 2;
const world = new RuntimeWorld({ scene });
world.setMode("game");
world.pushDelta(scene.settings.fixedStepMs);
assert(world.clock.frame === 2, `2x world speed should advance two ticks, got ${world.clock.frame}`);

world.setTimeScale(0.5);
world.pushDelta(scene.settings.fixedStepMs);
assert(world.clock.frame === 2, "0.5x world speed should accumulate half a tick");
world.pushDelta(scene.settings.fixedStepMs);
assert(world.clock.frame === 3, `0.5x world speed should advance after two fixed deltas, got ${world.clock.frame}`);

world.setTimeScale(0);
world.pushDelta(scene.settings.fixedStepMs * 8);
assert(world.clock.frame === 3, "0x world speed should pause fixed tick advancement");

console.log(JSON.stringify({ status: "passed", worldSpeed: world.timeScale, frame: world.clock.frame }, null, 2));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
