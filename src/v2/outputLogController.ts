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
      .map((line) => `
        <article class="v2-output-row">
          <time>${escapeHtml(line.at)}</time>
          <span>${escapeHtml(line.message)}</span>
        </article>
      `)
      .join("");
    return rows || `<article class="v2-card"><b>暂无输出</b><p>运行、导入、保存和窗口操作的消息会显示在这里。</p></article>`;
  }
}
