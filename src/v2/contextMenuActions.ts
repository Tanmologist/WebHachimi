import type { Entity, ProjectPatch, RenderComponent, Resource, Scene } from "../project/schema";
import { cloneJson, err, makeId, ok, type EntityId, type Result, type Vec2 } from "../shared/types";
import type { CanvasTargetPart } from "./renderer";

export type ContextMenuTransactionPlan = {
  patches: ProjectPatch[];
  inversePatches: ProjectPatch[];
  diffSummary: string;
  notice: string;
  selectedId?: EntityId;
  selectedPart?: CanvasTargetPart;
  createdEntity?: Entity;
  deletedEntityIds?: EntityId[];
};

export function planDeleteEntityTransaction(scene: Scene, entity: Entity): Result<ContextMenuTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (!storedEntity.persistent) return err("runtime-only entities cannot be deleted from the project");

  const deletedEntityIds = collectPersistentDescendantIds(scene, storedEntity.id);
  const deletedIdSet = new Set<EntityId>(deletedEntityIds);
  const nextFolders = scene.folders.map((folder) => ({
    ...cloneJson(folder),
    entityIds: folder.entityIds.filter((id) => !deletedIdSet.has(id)),
  }));
  const nextSelected = Object.values(scene.entities).find((item) => !deletedIdSet.has(item.id))?.id;
  const foldersPath = `/scenes/${scene.id}/folders` as ProjectPatch["path"];
  const patches: ProjectPatch[] = [{ op: "set", path: foldersPath, value: nextFolders }];
  const inversePatches: ProjectPatch[] = [{ op: "set", path: foldersPath, value: cloneJson(scene.folders) }];

  for (const entityId of deletedEntityIds) {
    const entityPath = `/scenes/${scene.id}/entities/${entityId}` as ProjectPatch["path"];
    patches.push({ op: "delete", path: entityPath });
    inversePatches.push({ op: "set", path: entityPath, value: cloneJson(scene.entities[entityId]) });
  }

  return ok({
    patches,
    inversePatches,
    diffSummary:
      deletedEntityIds.length > 1
        ? `删除 ${storedEntity.displayName} 及 ${deletedEntityIds.length - 1} 个子本体。`
        : `删除 ${storedEntity.displayName}。`,
    notice:
      deletedEntityIds.length > 1
        ? `已删除 ${storedEntity.displayName} 及 ${deletedEntityIds.length - 1} 个子本体。`
        : `已删除 ${storedEntity.displayName}。`,
    selectedId: nextSelected,
    selectedPart: "body",
    deletedEntityIds,
  });
}

export function planDuplicateEntityTransaction(
  scene: Scene,
  entity: Entity,
  options: { positionOffset?: Vec2; newId?: EntityId } = {},
): Result<ContextMenuTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (!storedEntity.persistent) return err("runtime-only entities cannot be duplicated into the project");

  const copyId = options.newId || (makeId<"EntityId">("entity") as EntityId);
  const offset = options.positionOffset || { x: 32, y: 32 };
  const copy: Entity = {
    ...cloneJson(storedEntity),
    id: copyId,
    internalName: uniqueInternalName(scene, `${storedEntity.internalName || "entity"}_copy`),
    displayName: uniqueDisplayName(scene, `${storedEntity.displayName} 副本`),
    transform: {
      ...cloneJson(storedEntity.transform),
      position: {
        x: storedEntity.transform.position.x + offset.x,
        y: storedEntity.transform.position.y + offset.y,
      },
    },
  };

  const foldersPath = `/scenes/${scene.id}/folders` as ProjectPatch["path"];
  const entityPath = `/scenes/${scene.id}/entities/${copy.id}` as ProjectPatch["path"];
  const patches: ProjectPatch[] = [{ op: "set", path: entityPath, value: copy }];
  const inversePatches: ProjectPatch[] = [{ op: "delete", path: entityPath }];

  const sourceFolderId = storedEntity.folderId || scene.folders.find((folder) => folder.entityIds.includes(storedEntity.id))?.id;
  if (sourceFolderId) {
    const nextFolders = cloneJson(scene.folders);
    const targetFolder = nextFolders.find((folder) => folder.id === sourceFolderId);
    if (targetFolder) {
      targetFolder.entityIds = [...targetFolder.entityIds.filter((id) => id !== copy.id), copy.id];
      copy.folderId = sourceFolderId;
      patches.push({ op: "set", path: foldersPath, value: nextFolders });
      inversePatches.unshift({ op: "set", path: foldersPath, value: cloneJson(scene.folders) });
    }
  }

  return ok({
    patches,
    inversePatches,
    diffSummary: `复制 ${storedEntity.displayName}。`,
    notice: `已复制 ${storedEntity.displayName}。`,
    selectedId: copy.id,
    selectedPart: "body",
    createdEntity: copy,
  });
}

export function planRenameEntityTransaction(scene: Scene, entity: Entity, rawDisplayName: string): Result<ContextMenuTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (!storedEntity.persistent) return err("runtime-only entities cannot be renamed in the project");
  const displayName = rawDisplayName.trim();
  if (!displayName) return err("entity display name cannot be empty");
  if (displayName === storedEntity.displayName) return err("entity display name is unchanged");

  const path = `/scenes/${scene.id}/entities/${storedEntity.id}` as ProjectPatch["path"];
  const nextEntity: Entity = {
    ...cloneJson(storedEntity),
    displayName,
  };
  return ok({
    patches: [{ op: "set", path, value: nextEntity }],
    inversePatches: [{ op: "set", path, value: cloneJson(storedEntity) }],
    diffSummary: `重命名 ${storedEntity.displayName} 为 ${displayName}。`,
    notice: `已重命名为 ${displayName}。`,
    selectedId: storedEntity.id,
    selectedPart: "body",
  });
}

export function planRenameResourceTransaction(
  resources: Record<string, Resource>,
  resource: Resource,
  rawDisplayName: string,
): Result<ContextMenuTransactionPlan> {
  const storedResource = resources[resource.id];
  if (!storedResource) return err(`resource not found: ${resource.id}`);
  const displayName = rawDisplayName.trim();
  if (!displayName) return err("resource display name cannot be empty");
  if (displayName === storedResource.displayName) return err("resource display name is unchanged");

  const path = `/resources/${storedResource.id}` as ProjectPatch["path"];
  const nextResource: Resource = {
    ...cloneJson(storedResource),
    displayName,
  };
  return ok({
    patches: [{ op: "set", path, value: nextResource }],
    inversePatches: [{ op: "set", path, value: cloneJson(storedResource) }],
    diffSummary: `重命名资源 ${storedResource.displayName} 为 ${displayName}。`,
    notice: `已重命名资源为 ${displayName}。`,
  });
}

export function planPresentationVisibilityTransaction(
  scene: Scene,
  entity: Entity,
  visible: boolean,
): Result<ContextMenuTransactionPlan> {
  return planRenderUpdate(scene, entity, (render) => ({ ...render, visible }), {
    diffSummary: `${visible ? "显示" : "隐藏"} ${entity.displayName} 的当前可视体。`,
    notice: `${entity.displayName} 的当前可视体已${visible ? "显示" : "隐藏"}。`,
    selectedPart: "presentation",
  });
}

export function planResetPresentationToBodyTransaction(scene: Scene, entity: Entity): Result<ContextMenuTransactionPlan> {
  return planRenderUpdate(
    scene,
    entity,
    (render, storedEntity) => ({
      ...render,
      visible: true,
      size: bodyVisualSize(storedEntity),
      offset: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    }),
    {
      diffSummary: `让 ${entity.displayName} 的当前可视体贴合本体。`,
      notice: `${entity.displayName} 的当前可视体已贴合本体。`,
      selectedPart: "presentation",
    },
  );
}

export function planRemovePresentationTransaction(scene: Scene, entity: Entity): Result<ContextMenuTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (!storedEntity.persistent) return err("runtime-only entities cannot be edited from the project");
  if (!storedEntity.render) return err("entity has no current presentation");
  const path = `/scenes/${scene.id}/entities/${storedEntity.id}/render` as ProjectPatch["path"];
  return ok({
    patches: [{ op: "delete", path }],
    inversePatches: [{ op: "set", path, value: cloneJson(storedEntity.render) }],
    diffSummary: `删除 ${storedEntity.displayName} 的当前可视体。`,
    notice: `${storedEntity.displayName} 的当前可视体已删除。`,
    selectedId: storedEntity.id,
    selectedPart: "body",
  });
}

function planRenderUpdate(
  scene: Scene,
  entity: Entity,
  update: (render: RenderComponent, entity: Entity) => RenderComponent,
  labels: { diffSummary: string; notice: string; selectedPart: CanvasTargetPart },
): Result<ContextMenuTransactionPlan> {
  const storedEntity = scene.entities[entity.id];
  if (!storedEntity) return err(`entity not found: ${entity.id}`);
  if (!storedEntity.persistent) return err("runtime-only entities cannot be edited from the project");
  if (!storedEntity.render) return err("entity has no current presentation");
  const path = `/scenes/${scene.id}/entities/${storedEntity.id}/render` as ProjectPatch["path"];
  return ok({
    patches: [{ op: "set", path, value: update(cloneJson(storedEntity.render), storedEntity) }],
    inversePatches: [{ op: "set", path, value: cloneJson(storedEntity.render) }],
    diffSummary: labels.diffSummary,
    notice: labels.notice,
    selectedId: storedEntity.id,
    selectedPart: labels.selectedPart,
  });
}

function collectPersistentDescendantIds(scene: Scene, rootId: EntityId): EntityId[] {
  const ordered: EntityId[] = [];
  const visit = (entityId: EntityId) => {
    const entity = scene.entities[entityId];
    if (!entity?.persistent) return;
    ordered.push(entityId);
    Object.values(scene.entities)
      .filter((item) => item.parentId === entityId)
      .forEach((child) => visit(child.id));
  };
  visit(rootId);
  return ordered;
}

function bodyVisualSize(entity: Entity): Vec2 {
  if (!entity.collider) return entity.render?.size || { x: 60, y: 60 };
  if (entity.collider.shape === "circle") {
    const diameter = (entity.collider.radius || Math.min(entity.collider.size.x, entity.collider.size.y) / 2) * 2;
    return { x: diameter, y: diameter };
  }
  return cloneJson(entity.collider.size);
}

function uniqueInternalName(scene: Scene, preferred: string): string {
  const names = new Set(Object.values(scene.entities).map((entity) => entity.internalName));
  return uniqueName(preferred, names);
}

function uniqueDisplayName(scene: Scene, preferred: string): string {
  const names = new Set(Object.values(scene.entities).map((entity) => entity.displayName));
  return uniqueName(preferred, names);
}

function uniqueName(preferred: string, existingNames: Set<string>): string {
  if (!existingNames.has(preferred)) return preferred;
  let index = 2;
  while (existingNames.has(`${preferred} ${index}`)) index += 1;
  return `${preferred} ${index}`;
}
