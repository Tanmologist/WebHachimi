import { escapeHtml } from "./viewText";

export type OutputLogLine = {
  id: number;
  at: string;
  message: string;
};

export class OutputLogController {
  private readonly lines: OutputLogLine[] = [];
  private lastMessage = "";
  private counter = 0;

  remember(message: string): void {
    const normalized = message.trim();
    if (!normalized || normalized === this.lastMessage) return;
    this.lastMessage = normalized;
    this.lines.push({
      id: ++this.counter,
      at: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      message: normalized,
    });
    if (this.lines.length > 80) this.lines.splice(0, this.lines.length - 80);
  }

  signature(): string {
    if (this.lines.length === 0) return "empty";
    return `${this.lines[0]?.id || 0}:${this.lines[this.lines.length - 1]?.id || 0}:${this.lines.length}`;
  }

  renderHtml(): string {
    const rows = this.lines
      .slice()
      .reverse()
      .map((line) => renderLogRow(line))
      .join("");
    return rows || `<article class="v2-card"><b>暂无输出</b><p>运行、导入、保存和窗口操作的消息会按时间倒序显示在这里，最多保留最近 80 条。</p></article>`;
  }
}

function renderLogRow(line: OutputLogLine): string {
  return `
    <article class="v2-output-row">
      <time>#${line.id} · ${escapeHtml(line.at)}</time>
      <span>${renderLogMessage(line.message)}</span>
    </article>
  `;
}

function renderLogMessage(message: string): string {
  return splitLogMessage(message)
    .map((segment) => escapeHtml(segment))
    .join("<br>");
}

function splitLogMessage(message: string): string[] {
  const normalized = message.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim()).filter(Boolean);
  if (normalized.length > 1) return normalized;
  const singleLine = normalized[0] || "";
  if (!singleLine) return [];
  if (singleLine.length > 32 && singleLine.includes("；")) return splitWithPunctuation(singleLine, "；");
  if (singleLine.length > 48 && singleLine.includes("。")) return splitWithPunctuation(singleLine, "。");
  return [singleLine];
}

function splitWithPunctuation(message: string, punctuation: "；" | "。"): string[] {
  return message
    .split(punctuation)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index, items) => (index < items.length - 1 || message.endsWith(punctuation) ? `${part}${punctuation}` : part));
}
