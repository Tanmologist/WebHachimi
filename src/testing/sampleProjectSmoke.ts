import { readFileSync } from "node:fs";
import { createStarterProject } from "../samples/starterProject";

const plainSample = createStarterProject();
const plainJson = JSON.stringify(plainSample);
assert(!plainJson.includes("/games/hachimi-nanbei-lvdong/"), "plain sample factory should not hard-code a concrete game package path");
assert(
  Object.values(plainSample.resources).every((resource) => resource.attachments.every((attachment) => attachment.path.trim() !== "")),
  "plain sample resources should not contain empty attachment paths",
);
assert(
  Object.values(plainSample.resources).flatMap((resource) => resource.attachments).length === 0,
  "plain sample should not attach external animation frames without a resource base path",
);

const basePath = "/games/hachimi-nanbei-lvdong/resources";
const packagedSample = createStarterProject({ resourceBasePath: basePath });
const packagedPaths = Object.values(packagedSample.resources)
  .flatMap((resource) => resource.attachments)
  .map((attachment) => attachment.path);

assert(packagedPaths.some((path) => path.startsWith(`${basePath}/`)), "sample resource base path should be injected by the app entry");
assert(
  packagedPaths.every((path) => !path.includes("//games/hachimi-nanbei-lvdong")),
  "sample resource base path should not double-prefix asset URLs",
);
assertNoGenericImport("src/editor/main.ts", "repairKnownStarterLabels");
assertNoGenericImport("src/player/main.ts", "repairKnownStarterLabels");

console.log(JSON.stringify({ status: "passed", packagedPathCount: packagedPaths.length }, null, 2));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertNoGenericImport(filePath: string, forbidden: string): void {
  const source = readFileSync(filePath, "utf8");
  assert(!source.includes(forbidden), `${filePath} should not import or call ${forbidden}`);
}
