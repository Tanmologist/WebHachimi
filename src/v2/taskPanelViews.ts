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
    .map((summary) => renderSummaryCard(summary))
    .join("");

  if (taskList.length === 0) {
    return `${summaryHtml}<article class="v2-card"><b>暂无任务</b></article>`;
  }

  return summaryHtml + taskList
    .map((task) => {
      const testRecords = task.testRecordRefs
        .map((id) => model.project.testRecords[id])
        .filter((record): record is Project["testRecords"][string] => Boolean(record));
      const trace =
        model.aiTraceByTask[task.id] ||
        task.testRecordRefs
          .map((id) => model.project.testRecords[id]?.traceSummary)
          .find(Boolean) ||
        "";
      const detailParts = [
        summarizeTargetCount(task.targetRefs.length),
        summarizeTransactionCount(task.transactionRefs.length),
        summarizeTestCount(testRecords.length),
        task.subtaskIds?.length ? `子任务 ${task.subtaskIds.length} 个` : "",
      ].filter(Boolean);
      const taskSummaryText = (task.normalizedText || task.userText).trim();
      const originalText = task.normalizedText && task.normalizedText !== task.userText ? task.userText.trim() : "";
      const brushSummary = task.brushContext?.summary ? `画笔上下文：${task.brushContext.summary}` : "";
      const testSummary = summarizeTestRecords(testRecords);
      const metaLine = [
        sourceLabel(task.source),
        statusLabel(task.status),
        `创建 ${formatDateTime(task.createdAt)}`,
        task.updatedAt !== task.createdAt ? `更新 ${formatDateTime(task.updatedAt)}` : "",
      ].filter(Boolean);
      return `
        <article class="v2-card ${model.previewTaskId === task.id ? "is-primary" : ""}" data-task-id="${task.id}">
          <b>${escapeHtml(task.title)}</b>
          <p>${escapeHtml(taskSummaryText)}</p>
          ${originalText ? `<p><small>原始输入：${escapeHtml(originalText)}</small></p>` : ""}
          ${detailParts.length ? `<p><small>${escapeHtml(detailParts.join(" · "))}</small></p>` : ""}
          ${brushSummary ? `<p><small>${escapeHtml(brushSummary)}</small></p>` : ""}
          ${testSummary ? `<p><small>${escapeHtml(testSummary)}</small></p>` : ""}
          <footer>
            <span>${escapeHtml(metaLine.join(" · "))}</span>
            <button data-preview-task="${task.id}" type="button">${model.previewTaskId === task.id ? "隐藏" : "预览"}</button>
          </footer>
          ${trace ? `<b>最近执行摘要</b><pre class="v2-trace">${escapeHtml(normalizeTextBlock(trace))}</pre>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderSummaryCard(summary: TaskPanelSummary): string {
  return `
    <article class="v2-card is-primary">
      <b>${escapeHtml(summaryTitle(summary.title))}</b>
      <pre class="v2-trace">${escapeHtml(formatSummaryBody(summary.body))}</pre>
    </article>
  `;
}

function summaryTitle(title: string): string {
  return (
    {
      "Timing sweep": "时间轴扫描摘要",
      "Scripted run": "脚本运行摘要",
      "Autonomous suite": "自主测试摘要",
      "Autonomous round": "自主轮次摘要",
      Maintenance: "维护摘要",
    } satisfies Record<string, string>
  )[title] || title;
}

function formatSummaryBody(body: string): string {
  const normalized = normalizeTextBlock(body);
  if (!normalized) return "";
  try {
    return formatStructuredSummary(JSON.parse(normalized));
  } catch {
    return normalized;
  }
}

function formatStructuredSummary(value: unknown, indent = 0, label = ""): string {
  const prefix = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return label ? `${prefix}${label}：无` : `${prefix}无`;
    if (value.every(isPrimitiveSummaryValue)) {
      return label ? `${prefix}${label}：${value.map(formatSummaryValue).join("、")}` : `${prefix}${value.map(formatSummaryValue).join("、")}`;
    }
    const lines = label ? [`${prefix}${label}：`] : [];
    value.forEach((item, index) => {
      if (isPlainObject(item)) {
        const nested = formatStructuredSummary(item, indent + 1, summarizeArrayItemLabel(item, index));
        if (nested) lines.push(nested);
        return;
      }
      lines.push(`${"  ".repeat(indent + 1)}- ${formatSummaryValue(item)}`);
    });
    return lines.filter(Boolean).join("\n");
  }
  if (isPlainObject(value)) {
    const lines = label ? [`${prefix}${label}：`] : [];
    Object.entries(value).forEach(([key, current]) => {
      if (current === undefined || current === null || current === "") return;
      const nested = formatStructuredSummary(current, indent + (label ? 1 : 0), summaryFieldLabel(key));
      if (nested) lines.push(nested);
    });
    return lines.filter(Boolean).join("\n");
  }
  const text = formatSummaryValue(value);
  if (!text) return "";
  return label ? `${prefix}${label}：${text}` : `${prefix}${text}`;
}

function summarizeArrayItemLabel(value: Record<string, unknown>, index: number): string {
  const title = typeof value.title === "string" && value.title.trim() ? value.title.trim() : "";
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : "";
  if (title && id) return `${index + 1}. ${title} (${id})`;
  if (title) return `${index + 1}. ${title}`;
  if (id) return `${index + 1}. ${id}`;
  return `${index + 1}. 条目`;
}

function summaryFieldLabel(field: string): string {
  return (
    {
      round: "轮次",
      startedAt: "开始时间",
      taskId: "任务 ID",
      taskTitle: "任务标题",
      taskStatus: "任务状态",
      taskRolledBack: "是否回滚",
      taskError: "任务错误",
      transactionId: "事务 ID",
      generatedTasks: "新生成任务",
      snapshotRefs: "快照引用",
      testRecordRefs: "测试记录",
      suiteStatus: "测试套件状态",
      suiteCaseCount: "用例总数",
      suitePassed: "通过",
      suiteFailed: "失败",
      suiteInterrupted: "中断",
      logErrors: "错误日志",
      logWarnings: "警告日志",
      usedFrozenSnapshot: "使用冻结快照",
      aiNextSteps: "建议后续动作",
      traceSummary: "追踪摘要",
      title: "标题",
      id: "ID",
      snapshotRef: "快照引用",
      mode: "模式",
      scannedAt: "扫描时间",
      beforeSnapshots: "扫描前快照数",
      afterSnapshots: "扫描后快照数",
      deletedSnapshots: "已删除快照",
      updatedRecords: "已更新记录",
      protectedSnapshots: "受保护快照",
      orphanSnapshots: "孤儿快照",
      stalePassedSnapshots: "过期通过快照",
      reclaimedApproxKb: "回收空间",
      reasons: "原因",
    } satisfies Record<string, string>
  )[field] || field;
}

function formatSummaryValue(value: unknown): string {
  if (value === true) return "是";
  if (value === false) return "否";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "无效数值";
  if (typeof value === "string") {
    const normalized = normalizeTextBlock(value);
    const asDate = looksLikeIsoDateTime(normalized) ? formatDateTime(normalized) : normalized;
    return asDate !== normalized ? asDate : normalized;
  }
  if (value === null || value === undefined) return "";
  return normalizeTextBlock(String(value));
}

function isPrimitiveSummaryValue(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function summarizeTargetCount(count: number): string {
  return count > 0 ? `目标 ${count} 个` : "全局任务";
}

function summarizeTransactionCount(count: number): string {
  return count > 0 ? `提交 ${count} 次` : "尚未提交";
}

function summarizeTestCount(count: number): string {
  return count > 0 ? `测试 ${count} 次` : "尚无测试";
}

function summarizeTestRecords(records: Project["testRecords"][string][]): string {
  if (!records.length) return "";
  return `最近测试：${records
    .map((record) => `${testStatusLabel(record.result)} · tick ${record.logs.at(-1)?.frame ?? 0}`)
    .join("；")}`;
}

function normalizeTextBlock(value: string): string {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function looksLikeIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
}
