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
const DEFAULT_PROJECT_PROFILE = "webhachimi";
const PROJECT_ENDPOINT_BY_PROFILE: Record<string, string> = {
  webhachimi: "/api/webhachimi/project",
  "hachimi-nanbei-lvdong": "/api/games/hachimi-nanbei-lvdong/project",
};
const LEGACY_V2_PROJECT_ENDPOINT = "/api/v2/project";

export class ProjectPersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectPersistenceError";
  }
}

export function currentProjectProfile(): string {
  if (typeof window === "undefined") return DEFAULT_PROJECT_PROFILE;
  const href = window.location?.href || "http://localhost/";
  const queryProfile = new URL(href).searchParams.get("project");
  const metaProfile = typeof document === "undefined"
    ? undefined
    : document.querySelector<HTMLMetaElement>('meta[name="webhachimi-project"]')?.content;
  return normalizeProjectProfile(queryProfile || metaProfile || DEFAULT_PROJECT_PROFILE);
}

export function defaultProjectEndpoint(profile = currentProjectProfile()): string {
  return PROJECT_ENDPOINT_BY_PROFILE[normalizeProjectProfile(profile)] || PROJECT_ENDPOINT_BY_PROFILE[DEFAULT_PROJECT_PROFILE];
}

export function projectLocalStorageKey(endpoint = defaultProjectEndpoint()): string {
  return `webhachimi:project:${profileForEndpoint(endpoint) || currentProjectProfile()}`;
}

export async function loadProject(endpoint = defaultProjectEndpoint()): Promise<LoadProjectResult> {
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
      const local = readLocalProject(endpoint);
      const selected = local && isProjectNewer(local, project) ? local : project;
      writeLocalProject(selected, endpoint);
      return { empty: false, project: selected, storage: selected === project ? "api" : "local" };
    }
    if (body.empty !== true) throw new ProjectPersistenceError("project response has an invalid shape");
  } catch (error) {
    const local = readLocalProject(endpoint);
    const warning = errorMessage(error);
    if (local) return { empty: false, project: local, storage: "local", warning };
    return { empty: true, project: null, storage: "local", warning };
  }

  const local = readLocalProject(endpoint);
  if (local) return { empty: false, project: local, storage: "local" };
  return { empty: true, project: null, storage: "api" };
}

export async function loadProjectFromDisk(
  endpoint = defaultProjectEndpoint(),
  options: { writeLocal?: boolean } = {},
): Promise<LoadProjectResult> {
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
      if (options.writeLocal !== false) writeLocalProject(project, endpoint);
      return { empty: false, project, storage: "api" };
    }
    if (body.empty === true) return { empty: true, project: null, storage: "api" };
    throw new ProjectPersistenceError("project response has an invalid shape");
  } catch (error) {
    return { empty: true, project: null, storage: "api", warning: errorMessage(error) };
  }
}

export async function saveProject(project: Project, endpoint = defaultProjectEndpoint()): Promise<SaveProjectResult> {
  writeLocalProject(project, endpoint);
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

function readLocalProject(endpoint = defaultProjectEndpoint()): Project | null {
  const storage = browserStorage();
  if (!storage) return null;
  const raw = storage.getItem(projectLocalStorageKey(endpoint));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isProject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalProject(project: Project, endpoint = defaultProjectEndpoint()): void {
  const storage = browserStorage();
  if (!storage) return;
  storage.setItem(projectLocalStorageKey(endpoint), JSON.stringify(project));
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function normalizeProjectProfile(value: string): string {
  const clean = value.trim().toLowerCase();
  if (/^[a-z0-9_-]+$/.test(clean)) return clean;
  return DEFAULT_PROJECT_PROFILE;
}

function profileForEndpoint(endpoint: string): string | undefined {
  if (endpoint === LEGACY_V2_PROJECT_ENDPOINT) return "hachimi-nanbei-lvdong";
  return Object.entries(PROJECT_ENDPOINT_BY_PROFILE).find(([, value]) => value === endpoint)?.[0];
}
