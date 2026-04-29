export type AutoSaveControllerDeps = {
  initialStatus: string;
  saveProject: () => Promise<string>;
  saveProjectLocally: () => string;
  shouldDeferSave: () => boolean;
  render: () => void;
};

export class AutoSaveController {
  private readonly deps: AutoSaveControllerDeps;
  private currentStatus: string;
  private timer: number | undefined;
  private dirty = false;
  private inFlight = false;
  private saveAgain = false;
  private activePromise: Promise<void> | undefined;

  constructor(deps: AutoSaveControllerDeps) {
    this.deps = deps;
    this.currentStatus = deps.initialStatus;
  }

  get status(): string {
    return this.currentStatus;
  }

  markDirty(reason: string): void {
    this.dirty = true;
    this.currentStatus = `${reason}，等待自动保存`;
    this.schedule();
  }

  setStatus(status: string): void {
    this.currentStatus = status;
  }

  reset(status: string): void {
    this.dirty = false;
    this.saveAgain = false;
    this.currentStatus = status;
    this.clearTimer();
  }

  async flushNow(): Promise<boolean> {
    if (!this.dirty && !this.saveAgain) return true;
    if (this.deps.shouldDeferSave()) {
      this.schedule(500);
      return false;
    }

    if (this.inFlight) {
      this.saveAgain = true;
      await this.activePromise;
      if (this.dirty || this.saveAgain) return this.flushNow();
      return true;
    }

    this.clearTimer();
    this.activePromise = this.runSave();
    await this.activePromise;
    return !this.dirty;
  }

  saveDirtyLocallyNow(): void {
    if (!this.dirty && !this.saveAgain) return;
    try {
      this.currentStatus = this.deps.saveProjectLocally();
      this.dirty = false;
      this.saveAgain = false;
    } catch (error) {
      this.currentStatus = `本地暂存失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private schedule(delayMs = 700): void {
    this.clearTimer();
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      void this.flushNow();
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async runSave(): Promise<void> {
    this.inFlight = true;
    this.dirty = false;
    this.saveAgain = false;
    this.currentStatus = "正在自动保存";
    this.deps.render();

    try {
      this.currentStatus = await this.deps.saveProject();
    } catch (error) {
      this.dirty = true;
      this.currentStatus = `自动保存失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.inFlight = false;
      this.activePromise = undefined;
      if (this.saveAgain || this.dirty) this.schedule(900);
      this.deps.render();
    }
  }
}
