export type ViewPanelId = "scene" | "properties" | "assets" | "tasks";
export type ViewToolId = "select" | "superBrush" | "shape" | "assist";
export type StorageSource = "api" | "local" | undefined;
export type ReactionCaseSummary = { status: string; expected?: string };

export function panelLabel(panel: ViewPanelId): string {
  return (
    {
      scene: "场景层级",
      properties: "属性",
      assets: "对象资源",
      tasks: "任务列表",
    } satisfies Record<ViewPanelId, string>
  )[panel];
}

export function toolLabel(tool: ViewToolId): string {
  return ({ select: "选择", superBrush: "超级画笔", shape: "柳叶笔", assist: "辅助" } satisfies Record<ViewToolId, string>)[tool];
}

export function typeLabel(kind: string): string {
  return (
    {
      entity: "实体（默认本体）",
      presentation: "表现体",
      trigger: "触发区",
      effect: "表现体",
      custom: "自定义",
    } satisfies Record<string, string>
  )[kind] || kind;
}

export function sourceLabel(source: string): string {
  return (
    {
      user: "用户",
      superBrush: "超级画笔",
      ai: "AI",
      testFailure: "测试失败",
    } satisfies Record<string, string>
  )[source] || source;
}

export function statusLabel(status: string): string {
  return (
    {
      draft: "草稿",
      queued: "排队",
      running: "执行中",
      passed: "已完成",
      failed: "失败",
      rolledBack: "已回滚",
    } satisfies Record<string, string>
  )[status] || status;
}

export function testStatusLabel(status: string): string {
  return (
    {
      passed: "通过",
      failed: "失败",
      interrupted: "中断",
      skipped: "跳过",
    } satisfies Record<string, string>
  )[status] || status;
}

export function storageLabel(storage: StorageSource): string {
  return storage === "local" ? "（本地浏览器）" : storage === "api" ? "（后端）" : "";
}

export function reactionCaseLabel(item: ReactionCaseSummary): string {
  if (item.expected && item.status !== item.expected) return `异常：${testStatusLabel(item.status)}`;
  if (item.expected === "failed") return "正确排除";
  if (item.expected === "passed") return "命中窗口";
  return testStatusLabel(item.status);
}

export function autonomousCaseLabel(label: string): string {
  if (label === "Scene structure smoke") return "场景结构冒烟";
  if (label === "Autonomous parry reaction") return "自治震刀反应";
  if (label === "parry success event exists") return "存在震刀成功事件";
  if (label === "scene snapshot matches active scene") return "场景快照匹配当前场景";
  if (label.startsWith("entity exists: ")) return `实体存在：${label.slice("entity exists: ".length)}`;
  if (label.startsWith("inspect defense offset ")) return `检查防御偏移 ${label.slice("inspect defense offset ".length)}`;
  if (label.startsWith("defense ")) return `防御 ${label.slice("defense ".length).replace("f", " 帧")}`;
  if (label.startsWith("scripted reaction check at tick ")) return `脚本反应检查 tick ${label.slice("scripted reaction check at tick ".length)}`;
  return label;
}

export function testCaseKindLabel(kind: string): string {
  return ({ structure: "结构检查", scriptedReaction: "脚本反应" } satisfies Record<string, string>)[kind] || kind;
}

export function aiEvidenceText(text: string): string {
  return text
    .replace("Capture a fresh frozen snapshot for this scene before rerunning.", "重新运行前先为当前场景捕捉新的冻结快照。")
    .replace("Open the first failed case logs and inspect its failureSnapshotRef.", "打开首个失败用例日志，并检查 failureSnapshotRef 指向的现场。")
    .replace("Add or tune combat-capable player/enemy behaviors so the reaction planner can derive an impact frame.", "补充或调整玩家/敌人的战斗行为，让反应规划器能推导命中 tick。")
    .replace("Add a playerPlatformer and enemyPatrol pair to enable autonomous reaction-window coverage.", "添加 playerPlatformer 与 enemyPatrol 组合，以启用反应窗口自治覆盖。")
    .replace("Broaden coverage with scene-specific checks for resources, triggers, or task acceptance criteria.", "继续加入资源、触发器或任务验收条件等场景专属检查。")
    .replace("Scene and sampled runtime entities survived a freeze inspection.", "场景与抽样运行实体已通过冻结检查。")
    .replace("Inspect failed frame checks first.", "先检查失败帧断言。")
    .replace("Could not derive a reliable hit frame for the player/enemy pair.", "无法为玩家/敌人组合推导可靠命中 tick。")
    .replace("Parry timing matched the generated reaction plan.", "震刀时机匹配生成的反应计划。")
    .replace("Review combat trace and timing window.", "检查战斗 trace 与时间窗口。");
}

export function expectedStatusLabel(status?: string): string {
  if (status === "passed") return "命中";
  if (status === "failed") return "排除";
  if (status === "interrupted") return "中断";
  return "未声明";
}

export function formatOffset(offset: number): string {
  return offset > 0 ? `+${offset}` : String(offset);
}

export function formatScale(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatMs(value: number): string {
  return `${Math.round(value)}ms`;
}

export function formatKb(value: number): string {
  return `${Math.max(0, Math.round(value / 1024))}KB`;
}

export function formatClock(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

export function shortRef(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" } as Record<string, string>)[char];
  });
}
