import type { TargetRef, Task } from "../project/schema";
import { createTask } from "../project/tasks";
import { err, ok, type Result } from "../shared/types";
import type { TaskId } from "../shared/types";

export type TaskDecompositionResult = {
  parent: Task;
  subtasks: Task[];
};

export function decomposeTask(task: Task): Result<TaskDecompositionResult | undefined> {
  if (task.source === "testFailure") return ok(undefined);
  if (task.parentTaskId || task.decomposition || task.subtaskIds?.length) return ok(undefined);

  const segments = splitTaskText(task.userText);
  if (segments.length < 2) return ok(undefined);
  if (segments.length > 5) return err("task decomposition supports at most 5 explicit steps");

  const subtasks: Task[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const created = createTask({
      source: task.source,
      title: `${task.title || "Task"} ${index + 1}/${segments.length}`,
      userText: segment,
      targetRefs: targetRefsForSegment(task.targetRefs, segment),
    });
    if (!created.ok) return created;
    subtasks.push({
      ...created.value,
      parentTaskId: task.id,
    });
  }

  const parent: Task = {
    ...task,
    status: "passed",
    subtaskIds: subtasks.map((subtask) => subtask.id as TaskId),
    decomposition: {
      version: 1,
      reason: "explicit sequential task text",
      parentText: task.userText,
      segments,
      createdTaskIds: subtasks.map((subtask) => subtask.id as TaskId),
    },
    normalizedText: task.normalizedText || normalizeTaskText(task.userText),
    updatedAt: new Date().toISOString(),
  };

  return ok({ parent, subtasks });
}

function splitTaskText(text: string): string[] {
  return text
    .split(/\s*(?:;|\n|\band then\b|\bthen\b)\s*/i)
    .map((segment) => normalizeTaskText(segment))
    .filter((segment) => segment.length > 0);
}

function targetRefsForSegment(parentTargets: TargetRef[], segment: string): TargetRef[] {
  if (mentionsSpecificRole(segment)) return [];
  return parentTargets;
}

function mentionsSpecificRole(text: string): boolean {
  return /\b(?:player|hero|character|enemy|attacker|foe|resource|asset|sprite|image|animation|audio)\b/i.test(text);
}

function normalizeTaskText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}
