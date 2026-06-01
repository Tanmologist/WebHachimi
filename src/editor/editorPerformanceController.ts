// Owns lightweight editor performance HUD state: render cadence, frame counters,
// allocation-pool stats, and throttled text updates. It only consumes renderer
// snapshots so the main editor loop can stay focused on simulation and UI work.
import type { RendererStats } from "./renderer";

export class EditorPerformanceController {
  private static readonly ANIMATION_FPS = 24;
  private static readonly HUD_REFRESH_MS = 250;
  private nextAnimationRenderAt = 0;
  private nextHudRefreshAt = 0;
  private windowStartedAt: number;
  private renderCount = 0;
  private statsTextValue = "帧率 -- · 渲染 --毫秒 · 对象 --";
  private hudTextValue = "帧 0 · 0.00秒 · --刻/秒 · 帧率 -- · 渲染 --毫秒 · 对象 --";

  constructor(startedAt: number) {
    this.windowStartedAt = startedAt;
    this.nextHudRefreshAt = startedAt;
  }

  getHudText(frame: number, timeMs: number, fixedStepMs: number, now = performance.now()): string {
    if (now < this.nextHudRefreshAt) return this.hudTextValue;
    const ticksPerSecond = fixedStepMs > 0 ? Math.round(1000 / fixedStepMs) : 0;
    this.hudTextValue = `帧 ${frame} · ${(timeMs / 1000).toFixed(2)}秒 · ${ticksPerSecond}刻/秒 · ${this.statsTextValue}`;
    this.nextHudRefreshAt = now + EditorPerformanceController.HUD_REFRESH_MS;
    return this.hudTextValue;
  }

  shouldRenderAnimationFrame(time: number, animatedResourcePresent: boolean): boolean {
    if (!animatedResourcePresent) return false;
    if (time < this.nextAnimationRenderAt) return false;
    this.nextAnimationRenderAt = time + 1000 / EditorPerformanceController.ANIMATION_FPS;
    return true;
  }

  recordRender(stats: RendererStats, now = performance.now()): void {
    this.renderCount += 1;
    if (now - this.windowStartedAt < 500) return;

    const fps = Math.round((this.renderCount * 1000) / Math.max(1, now - this.windowStartedAt));
    const created = stats.graphicsCreated + stats.spritesCreated + stats.textsCreated;
    const reused = stats.graphicsReused + stats.spritesReused + stats.textsReused;
    this.statsTextValue = `帧率 ${fps} · 渲染 ${stats.renderMs.toFixed(1)}毫秒 · 对象 ${stats.visibleObjects} · 池 ${reused}/${created}`;
    this.renderCount = 0;
    this.windowStartedAt = now;
    this.nextHudRefreshAt = 0;
  }
}
