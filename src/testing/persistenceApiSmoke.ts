import {
  currentProjectEndpoint,
  currentProjectProfile,
  defaultProjectEndpoint,
  loadProject,
  projectLocalStorageKey,
  saveProject,
  saveProjectLocally,
} from "../project/persistence";
import { cloneJson } from "../shared/types";
import { createStarterProject } from "../samples/starterProject";

async function main(): Promise<void> {
  const storage = new MemoryStorage();
  (globalThis as unknown as { window: { localStorage: Storage } }).window = { localStorage: storage as unknown as Storage };

  const apiProject = createStarterProject();
  apiProject.meta.name = "api-old";
  apiProject.meta.updatedAt = "2024-01-01T00:00:00.000Z";

  const localProject = cloneJson(apiProject);
  localProject.meta.name = "local-new";
  localProject.meta.updatedAt = "2026-04-28T00:00:00.000Z";

  saveProjectLocally(localProject);
  mockFetch(async (_input, init) => {
    assert(init?.method === "GET", "loadProject should issue a GET request first");
    assert(init.cache === "no-store", "loadProject should bypass HTTP cache");
    return jsonResponse({ project: apiProject });
  });

  const loaded = await loadProject();
  assert(loaded.project?.meta.name === "local-new", "newer local project should win over older API project");
  assert(loaded.storage === "local", `expected local storage source, got ${loaded.storage}`);

  const savedProject = cloneJson(apiProject);
  savedProject.meta.name = "save-target";
  savedProject.meta.updatedAt = "2026-04-28T01:00:00.000Z";
  let postedBody = "";
  mockFetch(async (_input, init) => {
    assert(init?.method === "POST", "saveProject should POST to the v2 endpoint");
    postedBody = String(init.body || "");
    return jsonResponse({ ok: true, savedAt: "2026-04-28T01:00:01.000Z" });
  });

  const saved = await saveProject(savedProject);
  const localAfterSave = JSON.parse(storage.getItem(projectLocalStorageKey()) || "{}") as { meta?: { name?: string } };
  assert(localAfterSave.meta?.name === "save-target", "saveProject should write localStorage before API result");
  assert(JSON.parse(postedBody).project.meta.name === "save-target", "saveProject should POST { project }");
  assert(saved.storage === "api", `expected api save source, got ${saved.storage}`);

  installProjectMeta({
    profile: "custom-game",
    endpoint: "/api/custom-game/project",
    href: "http://localhost/apps/webhachimi/editor.html",
  });
  assert(currentProjectProfile() === "custom-game", "project profile should come from page metadata");
  assert(currentProjectEndpoint() === "/api/custom-game/project", "project endpoint should come from page metadata");
  assert(defaultProjectEndpoint() === "/api/custom-game/project", "default endpoint should prefer configured page metadata");
  assert(projectLocalStorageKey() === "webhachimi:project:custom-game", "local project storage should remain profile-scoped");

  installProjectMeta({
    profile: "meta-game",
    endpoint: "/api/meta-game/project",
    href: "http://localhost/apps/webhachimi/editor.html?project=query-game&projectEndpoint=/api/query-game/project",
  });
  assert(currentProjectProfile() === "query-game", "query project profile should override page metadata");
  assert(currentProjectEndpoint() === "/api/query-game/project", "query project endpoint should override page metadata");
  assert(defaultProjectEndpoint() === "/api/query-game/project", "default endpoint should prefer query endpoint when present");
  assert(projectLocalStorageKey() === "webhachimi:project:query-game", "query endpoint should keep storage scoped to endpoint profile");

  installProjectMeta({
    profile: "fallback-game",
    endpoint: "https://example.com/not-same-origin",
    href: "http://localhost/apps/webhachimi/editor.html",
  });
  assert(defaultProjectEndpoint() === "/api/projects/fallback-game/project", "invalid endpoint metadata should fall back to profile route");
  assert(projectLocalStorageKey("/api/games/sandbox-project/project") === "webhachimi:project:sandbox-project", "game endpoint storage should infer the game profile");
  assert(projectLocalStorageKey("/api/only-endpoint/project") === "webhachimi:project:only-endpoint", "endpoint-only storage should infer a stable profile");
  assert(
    projectLocalStorageKey("/custom/project-a") !== projectLocalStorageKey("/custom/project-b"),
    "unknown explicit endpoints should not share localStorage buckets",
  );

  console.log(JSON.stringify({ status: "passed", loadedSource: loaded.storage, savedSource: saved.storage }, null, 2));
}

function mockFetch(handler: (input: RequestInfo | URL, init: RequestInit | undefined) => Promise<Response>): void {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL, init?: RequestInit) => handler(input, init)) as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    text: async () => JSON.stringify(body),
  } as Response;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installProjectMeta(input: { profile: string; endpoint: string; href: string }): void {
  (globalThis as unknown as { window: { localStorage: Storage; location: { href: string } } }).window = {
    localStorage: (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage,
    location: { href: input.href },
  };
  (globalThis as unknown as { document: { querySelector: (selector: string) => { content: string } | null } }).document = {
    querySelector: (selector: string) => {
      if (selector === 'meta[name="webhachimi-project"]') return { content: input.profile };
      if (selector === 'meta[name="webhachimi-project-endpoint"]') return { content: input.endpoint };
      return null;
    },
  };
}

class MemoryStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

void main();
