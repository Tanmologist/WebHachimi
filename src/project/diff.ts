import type { Project, ProjectPatch, Transaction } from "./schema";

export function summarizePatch(patch: ProjectPatch): string {
  if (patch.op === "set") return `set ${patch.path}`;
  if (patch.op === "delete") return `delete ${patch.path}`;
  return `append ${patch.path}`;
}

export function summarizeTransaction(transaction: Transaction): string {
  if (transaction.diffSummary.trim()) return transaction.diffSummary.trim();
  return transaction.patches.map(summarizePatch).join("\n");
}

export function projectHash(project: Project): string {
  const text = stableStringify(project);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
