import type { Project } from "../project/schema";
import {
  parseAutonomousSuiteSummary,
  parseMaintenanceSummary,
  parseScriptedRunSummary,
  parseSweepSummary,
  type AutonomousRoundSummary,
} from "./summaryModels";
import {
  aiEvidenceText,
  autonomousCaseLabel,
  escapeHtml,
  expectedStatusLabel,
  formatClock,
  formatMs,
  formatOffset,
  reactionCaseLabel,
  shortRef,
  sourceLabel,
  statusLabel,
  testCaseKindLabel,
  testStatusLabel,
} from "./viewText";

export type TaskPanelViewModel = {
  project: Project;
  previewTaskId: string;
  aiTraceByTask: Record<string, string>;
  autonomousRoundSummary?: AutonomousRoundSummary;
  lastMaintenanceSummary: string;
  lastAutonomousSuiteSummary: string;
  lastScriptedRunSummary: string;
  lastSweepSummary: string;
};

export function renderTaskPanelHtml(model: TaskPanelViewModel): string {
  const taskList = Object.values(model.project.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const autonomousRound = renderAutonomousRoundSummaryHtml(model.autonomousRoundSummary);
  const testSummaries = [
    autonomousRound,
    renderMaintenanceSummaryHtml(model.lastMaintenanceSummary),
    autonomousRound ? "" : renderAutonomousSuiteSummaryHtml(model.lastAutonomousSuiteSummary),
    renderScriptedRunSummaryHtml(model.lastScriptedRunSummary),
    renderSweepSummaryHtml(model.lastSweepSummary),
  ].join("");

  if (taskList.length === 0) {
    return `<article class="v2-card"><b>暂无任务</b><p>可以直接输入全局任务，也可以用超级画笔圈出区域后排队。</p></article>${testSummaries}`;
  }

  return (
    taskList
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
        return `
          <article class="v2-card ${model.previewTaskId === task.id ? "is-primary" : ""}" data-task-id="${task.id}">
            <b>${escapeHtml(task.title)}</b>
            <p>${escapeHtml(task.normalizedText || task.userText)}</p>
            <footer>
              <span>${sourceLabel(task.source)} · ${statusLabel(task.status)}${records ? ` · 测试 ${escapeHtml(records)}` : ""}</span>
              <button data-preview-task="${task.id}" type="button">${model.previewTaskId === task.id ? "隐藏" : "预览"}</button>
            </footer>
            ${trace ? `<pre class="v2-trace">${escapeHtml(trace)}</pre>` : ""}
          </article>
        `;
      })
      .join("") + testSummaries
  );
}

export function renderAutonomousRoundSummaryHtml(summary: AutonomousRoundSummary | undefined): string {
  if (!summary) return "";
  const generatedRows = summary.generatedTasks.length
    ? summary.generatedTasks
        .map(
          (task) => `
            <li>
              <span>${escapeHtml(task.title)}</span>
              <strong>${task.snapshotRef ? `快照 ${escapeHtml(shortRef(task.snapshotRef))}` : "等待执行"}</strong>
            </li>
          `,
        )
        .join("")
    : `<li><span>后续任务</span><strong>未生成</strong></li>`;
  const evidenceRows = [
    summary.taskId ? `任务 ${shortRef(summary.taskId)}` : "未执行任务",
    `${summary.testRecordRefs.length} 条测试记录`,
    `${summary.snapshotRefs.length} 个快照`,
    `${summary.suiteInterrupted} 个测试中断`,
    `日志 ${summary.logErrors} 错误 / ${summary.logWarnings} 警告`,
    summary.transactionId ? `事务 ${shortRef(summary.transactionId)}` : "",
    `时间 ${formatClock(summary.startedAt)}`,
  ]
    .filter(Boolean)
    .map((item) => `<li><span>${escapeHtml(item)}</span></li>`)
    .join("");
  const nextRows = summary.aiNextSteps
    .slice(0, 4)
    .map((step) => `<li><span>${escapeHtml(aiEvidenceText(step))}</span></li>`)
    .join("");
  return `
    <article class="v2-card v2-autonomy-card">
      <header class="v2-sweep-head">
        <b>AI自治工作台</b>
        <span class="v2-sweep-badge">第 ${summary.round} 轮 · ${testStatusLabel(summary.suiteStatus)}</span>
      </header>
      <section class="v2-script-metrics" aria-label="AI自治轮次摘要">
        <span><b>${summary.taskId ? testStatusLabel(summary.taskStatus) : "跳过"}</b><small>执行任务</small></span>
        <span><b>${summary.suitePassed}/${summary.suiteCaseCount}</b><small>测试通过</small></span>
        <span><b>${summary.suiteFailed}</b><small>测试失败</small></span>
        <span><b>${summary.generatedTasks.length}</b><small>后续任务</small></span>
        <span><b>${summary.snapshotRefs.length}</b><small>快照证据</small></span>
        <span><b>${summary.testRecordRefs.length}</b><small>测试记录</small></span>
      </section>
      <ul class="v2-evidence-list">
        <li><span>执行任务</span><strong>${escapeHtml(summary.taskTitle || "队列为空，直接运行自治测试")}</strong></li>
        <li><span>任务结果</span><strong>${escapeHtml(testStatusLabel(summary.taskStatus))}${summary.taskRolledBack ? " · 已回滚" : ""}${summary.taskError ? ` · ${escapeHtml(summary.taskError)}` : ""}</strong></li>
        <li><span>测试来源</span><strong>${summary.usedFrozenSnapshot ? "当前冻结现场" : "初始场景"}</strong></li>
      </ul>
      <ul class="v2-script-list">${generatedRows}</ul>
      ${evidenceRows ? `<ul class="v2-script-list">${evidenceRows}</ul>` : ""}
      ${nextRows ? `<ul class="v2-script-list">${nextRows}</ul>` : ""}
      ${summary.traceSummary ? `<pre class="v2-script-trace">${escapeHtml(summary.traceSummary)}</pre>` : ""}
    </article>
  `;
}

export function renderMaintenanceSummaryHtml(lastMaintenanceSummary: string): string {
  if (!lastMaintenanceSummary) return "";
  const summary = parseMaintenanceSummary(lastMaintenanceSummary);
  if (!summary) return "";
  const reasons = summary.reasons
    .slice(0, 5)
    .map((reason) => `<li><span>${escapeHtml(reason)}</span></li>`)
    .join("");
  const badge = summary.mode === "preview" ? "预览" : summary.mode === "auto" ? "后台" : "已执行";
  return `
    <article class="v2-card v2-script-card">
      <header class="v2-sweep-head">
        <b>项目清理</b>
        <span class="v2-sweep-badge">${badge}</span>
      </header>
      <section class="v2-script-metrics" aria-label="项目清理摘要">
        <span><b>${summary.beforeSnapshots}</b><small>原快照</small></span>
        <span><b>${summary.afterSnapshots}</b><small>剩余</small></span>
        <span><b>${summary.deletedSnapshots}</b><small>可清/已清</small></span>
        <span><b>${summary.protectedSnapshots}</b><small>保护</small></span>
        <span><b>${summary.updatedRecords}</b><small>记录更新</small></span>
        <span><b>${summary.reclaimedApproxKb}</b><small>KB</small></span>
      </section>
      <p>清理器只处理运行时快照：保留失败现场、任务引用、超级画笔引用和最近快照；不会删除场景、资源、任务或回滚事务。</p>
      ${reasons ? `<ul class="v2-script-list">${reasons}</ul>` : ""}
    </article>
  `;
}

export function renderAutonomousSuiteSummaryHtml(lastAutonomousSuiteSummary: string): string {
  if (!lastAutonomousSuiteSummary) return "";
  const summary = parseAutonomousSuiteSummary(lastAutonomousSuiteSummary);
  if (!summary) return "";
  const rows = summary.cases
    .map(
      (testCase) => `
        <li class="v2-sweep-row is-${escapeHtml(testCase.status)}">
          <span>${escapeHtml(autonomousCaseLabel(testCase.label))}</span>
          <strong>${escapeHtml(testStatusLabel(testCase.status))}</strong>
          <small>${escapeHtml(testCaseKindLabel(testCase.kind))} / 日志 ${testCase.logs.total} / 游戏耗时 ${formatMs(testCase.timings.totalDurationMs)}</small>
        </li>
      `,
    )
    .join("");
  const nextSteps = summary.aiNextSteps
    .slice(0, 4)
    .map((step) => `<li><span>${escapeHtml(aiEvidenceText(step))}</span></li>`)
    .join("");
  return `
    <article class="v2-card v2-script-card">
      <header class="v2-sweep-head">
        <b>AI自主测试</b>
        <span class="v2-sweep-badge">${summary.usedFrozenSnapshot ? "冻结现场" : "初始场景"}</span>
      </header>
      <section class="v2-script-metrics" aria-label="AI自主测试摘要">
        <span><b>${summary.caseCount}</b><small>用例</small></span>
        <span><b>${summary.passed}</b><small>通过</small></span>
        <span><b>${summary.failed}</b><small>失败</small></span>
        <span><b>${summary.interrupted}</b><small>中断</small></span>
        <span><b>${summary.logErrors}</b><small>错误</small></span>
        <span><b>${summary.snapshotCount}</b><small>快照</small></span>
      </section>
      <p>AI 从当前冻结现场生成测试计划，自动执行、收集结构化日志和耗时；失败用例会进入任务队列。</p>
      <ul class="v2-script-list">${rows}</ul>
      ${nextSteps ? `<ul class="v2-script-list">${nextSteps}</ul>` : ""}
      ${summary.traceSummary ? `<pre class="v2-script-trace">${escapeHtml(summary.traceSummary)}</pre>` : ""}
    </article>
  `;
}

export function renderScriptedRunSummaryHtml(lastScriptedRunSummary: string): string {
  if (!lastScriptedRunSummary) return "";
  const summary = parseScriptedRunSummary(lastScriptedRunSummary);
  if (!summary) return "";
  const timingRows = summary.timings
    .slice(0, 8)
    .map(
      (timing) => `
        <li>
          <span>${escapeHtml(timing.label)}</span>
          <strong>tick ${timing.startTick}-${timing.endTick} · ${formatMs(timing.durationMs)} 游戏 · ${formatMs(timing.scaledDurationMs)} 慢放</strong>
        </li>
      `,
    )
    .join("");
  return `
    <article class="v2-card v2-script-card">
      <header class="v2-sweep-head">
        <b>脚本测试 / AI 预输入</b>
        <span class="v2-sweep-badge">携带脚本运行</span>
      </header>
      <section class="v2-script-metrics" aria-label="脚本测试摘要">
        <span><b>${summary.tickRate}</b><small>tick/s</small></span>
        <span><b>${summary.timeScale}×</b><small>${summary.timeScaleMode === "manual" ? "手动慢放" : "AI慢放"}</small></span>
        <span><b>${summary.impactFrame}</b><small>命中 tick</small></span>
        <span><b>${summary.defenseInputFrame}</b><small>预输入</small></span>
        <span><b>${summary.stepCount}</b><small>步骤</small></span>
        <span><b>${escapeHtml(testStatusLabel(summary.result))}</b><small>结果</small></span>
      </section>
      <p>AI 先暂停在模拟世界中计算游戏刻度，再生成输入脚本：敌人攻击、玩家按 tick 预输入震刀、命中 tick 冻结检查。慢放倍率由接口自由调节，当前按 ${summary.timeScale} 倍记录耗时。</p>
      ${summary.timeScaleReason ? `<p class="v2-script-reason">${escapeHtml(summary.timeScaleReason)}</p>` : ""}
      <ul class="v2-script-list">
        <li><span>敌人攻击输入</span><strong>tick ${summary.attackInputFrame}</strong></li>
        <li><span>敌人攻击启动</span><strong>${summary.attackStartedFrame === undefined ? "未记录" : `tick ${summary.attackStartedFrame}`}</strong></li>
        <li><span>玩家震刀预输入</span><strong>tick ${summary.defenseInputFrame}</strong></li>
        <li><span>冻结检查</span><strong>tick ${summary.probeFrame}</strong></li>
        <li><span>脚本游戏耗时</span><strong>${formatMs(summary.totalGameMs)}</strong></li>
        <li><span>慢放回放耗时</span><strong>${formatMs(summary.totalScaledMs)}</strong></li>
      </ul>
      ${timingRows ? `<ul class="v2-script-list">${timingRows}</ul>` : ""}
      ${summary.traceSummary ? `<pre class="v2-script-trace">${escapeHtml(summary.traceSummary)}</pre>` : ""}
    </article>
  `;
}

export function renderSweepSummaryHtml(lastSweepSummary: string): string {
  if (!lastSweepSummary) return "";
  const items = parseSweepSummary(lastSweepSummary);
  const total = items.length;
  const accepted = items.filter((item) => item.status === "passed" && item.expected === "passed").length;
  const rejected = items.filter((item) => item.status === "failed" && item.expected === "failed").length;
  const mismatch = items.filter((item) => item.expected && item.status !== item.expected).length;
  const rows = items
    .map(
      (item) => `
        <li class="v2-sweep-row is-${escapeHtml(item.status)} ${item.expected && item.status !== item.expected ? "is-mismatch" : "is-matched"}">
          <span>偏移 ${formatOffset(item.offset)} tick</span>
          <strong>${escapeHtml(reactionCaseLabel(item))}</strong>
          <small>${escapeHtml(item.label)} / 预期 ${escapeHtml(expectedStatusLabel(item.expected))}</small>
        </li>
      `,
    )
    .join("");
  return `
    <article class="v2-card v2-sweep-card">
      <header class="v2-sweep-head">
        <b>时间轴扫描 / AI 测试</b>
        <span class="v2-sweep-badge">战斗事件已接入</span>
      </header>
      <section class="v2-sweep-metrics" aria-label="时间轴扫描结果摘要">
        <span><b>${accepted}</b><small>命中</small></span>
        <span><b>${rejected}</b><small>排除</small></span>
        <span><b>${mismatch}</b><small>异常</small></span>
        <span><b>${total}</b><small>offset</small></span>
      </section>
      <p>当前结果来自运行时战斗事件：AI 预设敌人攻击帧、玩家防御帧，并在冻结检查时查找震刀成功事件。窗口外失败是正确的负样本。</p>
      ${mismatch ? `<p class="v2-sweep-warning">异常 ${mismatch} 个；实际结果和预期窗口不一致，请优先检查对应 offset。</p>` : ""}
      <ul class="v2-sweep-list">${rows}</ul>
    </article>
  `;
}
