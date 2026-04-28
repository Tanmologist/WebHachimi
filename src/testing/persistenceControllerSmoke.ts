import { buildProjectForSave } from "../v2/persistenceController";
import { createStarterProject } from "../v2/starterProject";
import { cloneJson } from "../shared/types";

const project = createStarterProject();
const scene = project.scenes[project.activeSceneId];
if (!scene) throw new Error(`active scene not found: ${project.activeSceneId}`);

const persistentEntity = Object.values(scene.entities).find((entity) => entity.persistent);
if (!persistentEntity) throw new Error("starter project must contain a persistent entity");
const transientEntity = Object.values(scene.entities).find((entity) => !entity.persistent);
if (!transientEntity) throw new Error("starter project must contain a transient entity");

const runtimePersistent = cloneJson(persistentEntity);
runtimePersistent.transform.position.x += 123;
runtimePersistent.transform.position.y -= 45;

const runtimeTransient = cloneJson(transientEntity);
runtimeTransient.transform.position.x += 999;
runtimeTransient.transform.position.y += 999;

const editorScene = cloneJson(scene);
editorScene.folders = [
  ...editorScene.folders,
  { id: "qa-folder", displayName: "QA Folder", entityIds: [persistentEntity.id] },
];
editorScene.layers = editorScene.layers.map((layer) => ({ ...layer, locked: true }));

const savedProject = buildProjectForSave({
  project,
  scene: editorScene,
  entities: [runtimePersistent, runtimeTransient],
});
const savedScene = savedProject.scenes[savedProject.activeSceneId];
if (!savedScene) throw new Error(`saved active scene not found: ${savedProject.activeSceneId}`);

assert(
  savedScene.entities[persistentEntity.id].transform.position.x === runtimePersistent.transform.position.x,
  "persistent runtime entity x position should be merged into saved project",
);
assert(
  savedScene.entities[persistentEntity.id].transform.position.y === runtimePersistent.transform.position.y,
  "persistent runtime entity y position should be merged into saved project",
);
assert(
  savedScene.entities[transientEntity.id].transform.position.x === transientEntity.transform.position.x,
  "transient runtime entity x position should not overwrite stored project entity",
);
assert(
  savedScene.folders.some((folder) => folder.id === "qa-folder"),
  "editor scene folders should be copied into saved project",
);
assert(
  savedScene.entities[persistentEntity.id].folderId === "qa-folder",
  "saved persistent entity folderId should match copied editor folder membership",
);
assert(
  savedScene.entities[transientEntity.id].folderId === "runtime",
  "saved transient entity folderId should still match copied editor folder membership",
);
assert(
  savedScene.layers.every((layer) => layer.locked),
  "editor scene layers should be copied into saved project",
);
assert(
  project.scenes[project.activeSceneId].entities[persistentEntity.id].transform.position.x === persistentEntity.transform.position.x,
  "buildProjectForSave should not mutate the input project",
);
assert(savedProject.meta.updatedAt !== project.meta.updatedAt || savedProject !== project, "saved project should be a refreshed clone");

console.log(
  JSON.stringify(
    {
      status: "passed",
      persistentEntityId: persistentEntity.id,
      transientEntityId: transientEntity.id,
      mergedPosition: savedScene.entities[persistentEntity.id].transform.position,
      transientStoredPosition: savedScene.entities[transientEntity.id].transform.position,
      folderCount: savedScene.folders.length,
    },
    null,
    2,
  ),
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
