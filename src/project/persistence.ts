import type { Project } from "./schema";

export type LoadProjectResult = {
  empty: boolean;
  project: Project | null;
  storage?: "api" | "local";
  warning?: string;
};

export type SaveProjectResult = {
  ok: true;
  savedAt?: string;
  storage?: "api" | "local";
  warning?: string;
};

type ApiObject = Record<string, unknown>;
const LOCAL_PROJECT_KEY = "webhachimi:v2:project";
const V2_PROJECT_ENDPOINT = "/api/v2/project";

export class ProjectPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPersistenceError";
  }
}

export async function loadProject(endpoint = V2_PROJECT_ENDPOINT): Promise<LoadProjectResult> {
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    const payload = await readJson(response);
    if (!response.ok) throw apiError("load project failed", payload);

    const body = objectPayload(payload);
    const project = body.project ?? body.scene ?? null;
    if (project !== null) {
      if (!isProject(project)) throw new ProjectPersistenceError("project response has an invalid shape");
      const local = readLocalProject();
      const selected = local && isProjectNewer(local, project) ? local : project;
      writeLocalProject(selected);
      return { empty: false, project: selected, storage: selected === project ? "api" : "local" };
    }
    if (body.empty !== true) throw new ProjectPersistenceError("project response has an invalid shape");
  } catch (error) {
    const local = readLocalProject();
    const warning = errorMessage(error);
    if (local) return { empty: false, project: local, storage: "local", warning };
    return { empty: true, project: null, storage: "local", warning };
  }

  const local = readLocalProject();
  if (local) return { empty: false, project: local, storage: "local" };
  return { empty: true, project: null, storage: "api" };
}

export async function saveProject(project: Project, endpoint = V2_PROJECT_ENDPOINT): Promise<SaveProjectResult> {
  writeLocalProject(project);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ project }),
    });
    const payload = await readJson(response);
    if (!response.ok) throw apiError("save project failed", payload);

    const body = objectPayload(payload);
    if (body.ok === false) throw apiError("save project failed", payload);
    return { ok: true, savedAt: typeof body.savedAt === "string" ? body.savedAt : undefined, storage: "api" };
  } catch (error) {
    return { ok: true, savedAt: project.meta.updatedAt, storage: "local", warning: errorMessage(error) };
  }
}

export function saveProjectLocally(project: Project): SaveProjectResult {
  writeLocalProject(project);
  return { ok: true, savedAt: project.meta.updatedAt, storage: "local" };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProjectPersistenceError("project api returned invalid json");
  }
}

function objectPayload(payload: unknown): ApiObject {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as ApiObject) : {};
}

function apiError(fallback: string, payload: unknown): ProjectPersistenceError {
  const body = objectPayload(payload);
  return new ProjectPersistenceError(typeof body.error === "string" ? body.error : fallback);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isProject(value: unknown): value is Project {
  const project = objectPayload(value);
  return (
    project.kind === "webhachimi-v2-project" &&
    project.version === 1 &&
    typeof project.activeSceneId === "string" &&
    isRecord(project.scenes) &&
    isRecord(project.resources) &&
    isRecord(project.tasks) &&
    isRecord(project.transactions) &&
    isRecord(project.testRecords) &&
    (project.snapshots === undefined || isRecord(project.snapshots)) &&
    (project.autonomyRuns === undefined || isRecord(project.autonomyRuns)) &&
    typeof objectPayload(project.meta).name === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isProjectNewer(left: Project, right: Project): boolean {
  const leftTime = Date.parse(left.meta.updatedAt);
  const rightTime = Date.parse(right.meta.updatedAt);
  if (Number.isNaN(leftTime)) return false;
  if (Number.isNaN(rightTime)) return true;
  return leftTime > rightTime;
}

function readLocalProject(): Project | null {
  const storage = browserStorage();
  if (!storage) return null;
  const raw = storage.getItem(LOCAL_PROJECT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isProject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalProject(project: Project): void {
  const storage = browserStorage();
  if (!storage) return;
  storage.setItem(LOCAL_PROJECT_KEY, JSON.stringify(project));
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
