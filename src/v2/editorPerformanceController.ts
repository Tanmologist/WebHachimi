import type { RendererStats } from "./renderer";

export class EditorPerformanceController {
  private nextAnimationRenderAt = 0;
  private windowStartedAt: number;
  private renderCount = 0;
  private textValue = "fps -- · render --ms · obj --";

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
    this.textValue = `${fps}fps · render ${(now - renderStarted).toFixed(1)}ms · obj ${stats.visibleObjects} · pool ${reused}/${created}`;
    this.renderCount = 0;
    this.windowStartedAt = now;
  }
}
