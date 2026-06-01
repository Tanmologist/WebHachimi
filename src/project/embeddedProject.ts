// Owns reading embedded project JSON from static HTML exports.
// Player and editor entries both use this when a project is packaged directly
// into the page, keeping static demos independent from the local project API.
import type { Project } from "./schema";

export function embeddedProjectFromDocument(documentRef: Document = document): Project | null {
  const element = documentRef.querySelector<HTMLScriptElement>('script[type="application/json"][data-webhachimi-project]');
  const raw = element?.textContent?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Project;
    return parsed?.kind === "webhachimi-v2-project" && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}
