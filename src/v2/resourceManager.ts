import type { Project, Resource, ResourceAttachment } from "../project/schema";
import { cloneJson, makeId, type ResourceId } from "../shared/types";
import type { ResourceImportMetadata } from "./resourceImport";
import { resourceTagsForType } from "./resourceImport";

export type ResourceManagerState = {
  resources: Record<string, Resource>;
};

export type AddResourceInput = ResourceImportMetadata;

export type UpdateResourceInput = {
  id: ResourceId;
  displayName?: string;
  description?: string;
  aiDescription?: string;
  tags?: string[];
  sprite?: Resource["sprite"];
};

export type ResourceOperation = {
  resource: Resource;
  patches: Array<{ op: "set" | "delete"; path: string; value?: unknown }>;
  inversePatches: Array<{ op: "set" | "delete"; path: string; value?: unknown }>;
};

export function createResourceManager() {
  function buildResource(input: AddResourceInput): Resource {
    const resourceId = makeId<"ResourceId">("res") as ResourceId;
    const attachments = input.attachments && input.attachments.length > 0
      ? input.attachments.map((attachment) => ({
          id: makeId<"ResourceAttachmentId">("att"),
          fileName: attachment.fileName,
          mime: attachment.mime,
          path: attachment.path,
        }))
      : input.path
        ? [{
            id: makeId<"ResourceAttachmentId">("att"),
            fileName: input.fileName,
            mime: input.mime,
            path: input.path,
          }]
        : [];

    return {
      id: resourceId,
      internalName: input.displayName || "未命名资源",
      displayName: input.displayName || "未命名资源",
      type: input.type,
      description: input.description,
      tags: resourceTagsForType(input.type),
      attachments,
      sprite: input.sprite ? cloneJson(input.sprite) : undefined,
    };
  }

  function makeUniqueInternalName(baseName: string, existing: Record<string, Resource>): string {
    const safe = baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "-").replace(/^-+|-+$/g, "") || "resource";
    const existingNames = new Set(Object.values(existing).map((r) => r.internalName));
    if (!existingNames.has(safe)) return safe;
    let index = 2;
    while (existingNames.has(`${safe}-${index}`)) index += 1;
    return `${safe}-${index}`;
  }

  function addResource(input: AddResourceInput, existing: Record<string, Resource>): ResourceOperation {
    const resource = buildResource(input);
    resource.internalName = makeUniqueInternalName(input.displayName, existing);
    return {
      resource,
      patches: [{ op: "set", path: `/resources/${resource.id}`, value: resource }],
      inversePatches: [{ op: "delete", path: `/resources/${resource.id}` }],
    };
  }

  function updateResource(input: UpdateResourceInput, current: Resource): ResourceOperation {
    const updated = cloneJson(current);
    if (input.displayName !== undefined) updated.displayName = input.displayName;
    if (input.description !== undefined) updated.description = input.description;
    if (input.aiDescription !== undefined) updated.aiDescription = input.aiDescription;
    if (input.tags !== undefined) updated.tags = [...input.tags];
    if (input.sprite !== undefined) updated.sprite = cloneJson(input.sprite);

    return {
      resource: updated,
      patches: [{ op: "set", path: `/resources/${updated.id}`, value: updated }],
      inversePatches: [{ op: "set", path: `/resources/${current.id}`, value: current }],
    };
  }

  function removeResource(id: ResourceId, current: Resource): ResourceOperation {
    return {
      resource: current,
      patches: [{ op: "delete", path: `/resources/${id}` }],
      inversePatches: [{ op: "set", path: `/resources/${id}`, value: current }],
    };
  }

  function getResource(id: ResourceId, project: Project): Resource | undefined {
    return project.resources[id];
  }

  function listResources(project: Project): Resource[] {
    return Object.values(project.resources).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  function getAttachmentUrl(attachment: ResourceAttachment): string {
    if (attachment.path.startsWith("data:")) return attachment.path;
    return attachment.path;
  }

  function isVisualResourceType(type: Resource["type"]): boolean {
    return type === "image" || type === "sprite" || type === "animation";
  }

  return {
    buildResource,
    makeUniqueInternalName,
    addResource,
    updateResource,
    removeResource,
    getResource,
    listResources,
    getAttachmentUrl,
    isVisualResourceType,
  };
}

export type ResourceManager = ReturnType<typeof createResourceManager>;
