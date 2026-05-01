import type { RendererStats } from "./renderer";

export class EditorPerformanceController {
  private nextAnimationRenderAt = 0;
  private windowStartedAt: number;
  private renderCount = 0;
  private textValue = "帧率 -- · 渲染 --毫秒 · 对象 --";

  constructor(startedAt: number) {
    this.windowStartedAt = startedAt;
  }

  get frameText(): string {
    return this.textValue;
  }

  shouldRenderAnimationFrame(time: number, animatedResourcePresent: boolean): boolean {
    if (!animatedResourcePresent) return false;
    if (time < this.nextAnimationRenderAt) return false;
    this.nextAnimationRenderAt = time + 1000 / 24;
    return true;
  }

  recordRender(renderStarted: number, stats: RendererStats, now = performance.now()): void {
    this.renderCount += 1;
    if (now - this.windowStartedAt < 500) return;

    const fps = Math.round((this.renderCount * 1000) / Math.max(1, now - this.windowStartedAt));
    const created = stats.graphicsCreated + stats.spritesCreated;
    const reused = stats.graphicsReused + stats.spritesReused;
    this.textValue = `帧率 ${fps} · 渲染 ${(now - renderStarted).toFixed(1)}毫秒 · 对象 ${stats.visibleObjects} · 池 ${reused}/${created}`;
    this.renderCount = 0;
    this.windowStartedAt = now;
  }
}
