import type { Project } from "../project/schema";
import { escapeHtml, sourceLabel, statusLabel, testStatusLabel } from "./viewText";

export type TaskPanelViewModel = {
  project: Project;
  previewTaskId: string;
  aiTraceByTask: Record<string, string>;
  summaries?: TaskPanelSummary[];
};

export type TaskPanelSummary = {
  title: string;
  body: string;
};

export function renderTaskPanelHtml(model: TaskPanelViewModel): string {
  const taskList = Object.values(model.project.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const summaryHtml = (model.summaries || [])
    .filter((summary) => summary.body.trim())
    .map((summary) => `
      <article class="v2-card is-primary">
        <b>${escapeHtml(summary.title)}</b>
        <pre class="v2-trace">${escapeHtml(summary.body)}</pre>
      </article>
    `)
    .join("");

  if (taskList.length === 0) {
    return `${summaryHtml}<article class="v2-card"><b>暂无任务</b><p>输入任务后可以排队；任务目标会按当前选择、框选或全局状态自动决定。</p></article>`;
  }

  return summaryHtml + taskList
    .map((task) => {
      const records = task.testRecordRefs
        .map((id) => model.project.testRecords[id])
        .filter(Boolean)
        .map((record) => `${testStatusLabel(record.result)} · tick ${record.logs.at(-1)?.frame ?? 0}`)
        .join(" / ");
      const trace =
        model.aiTraceByTask[task.id] ||
        task.testRecordRefs
          .map((id) => model.project.testRecords[id]?.traceSummary)
          .find(Boolean) ||
        "";
      const brushSummary = task.brushContext?.summary ? ` · ${escapeHtml(task.brushContext.summary)}` : "";
      return `
        <article class="v2-card ${model.previewTaskId === task.id ? "is-primary" : ""}" data-task-id="${task.id}">
          <b>${escapeHtml(task.title)}</b>
          <p>${escapeHtml(task.normalizedText || task.userText)}</p>
          <footer>
            <span>${sourceLabel(task.source)} · ${statusLabel(task.status)}${brushSummary}${records ? ` · 测试 ${escapeHtml(records)}` : ""}</span>
            <button data-preview-task="${task.id}" type="button">${model.previewTaskId === task.id ? "隐藏" : "预览"}</button>
          </footer>
          ${trace ? `<pre class="v2-trace">${escapeHtml(trace)}</pre>` : ""}
        </article>
      `;
    })
    .join("");
}
