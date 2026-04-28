import type { Project, ProjectPatch, Transaction } from "./schema";
import { cloneJson, err, ok, type Result } from "../shared/types";

export type TransactionApplyResult = {
  project: Project;
  transaction: Transaction;
};

export function dryRunTransaction(project: Project, transaction: Transaction): Result<TransactionApplyResult> {
  const draft = cloneJson(project);
  const result = applyPatchesInPlace(draft, transaction.patches);
  if (!result.ok) return result;
  return ok({ project: draft, transaction: { ...transaction, status: "dryRun" } });
}

export function applyTransaction(project: Project, transaction: Transaction): Result<TransactionApplyResult> {
  const dryRun = dryRunTransaction(project, transaction);
  if (!dryRun.ok) return dryRun;
  const applied: Transaction = {
    ...transaction,
    status: "applied",
    appliedAt: new Date().toISOString(),
  };
  dryRun.value.project.transactions[applied.id] = applied;
  dryRun.value.project.meta.updatedAt = applied.appliedAt || dryRun.value.project.meta.updatedAt;
  return ok({ project: dryRun.value.project, transaction: applied });
}

export function rollbackTransaction(project: Project, transaction: Transaction): Result<TransactionApplyResult> {
  const draft = cloneJson(project);
  const result = applyPatchesInPlace(draft, transaction.inversePatches);
  if (!result.ok) return result;
  const rolledBack: Transaction = {
    ...transaction,
    status: "rolledBack",
    rolledBackAt: new Date().toISOString(),
  };
  draft.transactions[rolledBack.id] = rolledBack;
  draft.meta.updatedAt = rolledBack.rolledBackAt || draft.meta.updatedAt;
  return ok({ project: draft, transaction: rolledBack });
}

function applyPatchesInPlace(project: Project, patches: ProjectPatch[]): Result<void> {
  for (const patch of patches) {
    const segments = parsePath(patch.path);
    if (segments.length === 0) return err("patch path cannot be empty");
    const parent = resolveParent(project, segments);
    if (!parent.ok) return parent;
    const key = segments[segments.length - 1];
    if (patch.op === "set") {
      parent.value[key] = cloneJson(patch.value);
    } else if (patch.op === "delete") {
      delete parent.value[key];
    } else if (patch.op === "append") {
      const current = parent.value[key];
      if (!Array.isArray(current)) return err(`patch target is not an array: ${patch.path}`);
      current.push(cloneJson(patch.value));
    }
  }
  return ok(undefined);
}

function parsePath(path: string): string[] {
  return path.split("/").map((part) => part.trim()).filter(Boolean);
}

function resolveParent(root: unknown, segments: string[]): Result<Record<string, unknown>> {
  let current = root as Record<string, unknown>;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    const next = current[key];
    if (!next || typeof next !== "object") return err(`patch path does not exist: ${segments.join("/")}`);
    current = next as Record<string, unknown>;
  }
  return ok(current);
}
