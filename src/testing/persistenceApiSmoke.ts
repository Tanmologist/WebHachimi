import { loadProject, saveProject, saveProjectLocally } from "../project/persistence";
import { cloneJson } from "../shared/types";
import { createStarterProject } from "../v2/starterProject";

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
  const localAfterSave = JSON.parse(storage.getItem("webhachimi:v2:project") || "{}") as { meta?: { name?: string } };
  assert(localAfterSave.meta?.name === "save-target", "saveProject should write localStorage before API result");
  assert(JSON.parse(postedBody).project.meta.name === "save-target", "saveProject should POST { project }");
  assert(saved.storage === "api", `expected api save source, got ${saved.storage}`);

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
