import type { RuntimeMode } from "../shared/types";

export type FixedStepClockOptions = {
  fixedStepMs: number;
  maxStepsPerFrame: number;
};

export type ClockTick = {
  steps: number;
  alpha: number;
};

export type ClockState = {
  frame: number;
  timeMs: number;
  accumulatorMs: number;
};

export class FixedStepClock {
  readonly fixedStepMs: number;
  readonly maxStepsPerFrame: number;
  mode: RuntimeMode = "editorFrozen";
  frame = 0;
  timeMs = 0;
  private accumulatorMs = 0;

  constructor(options: FixedStepClockOptions) {
    this.fixedStepMs = options.fixedStepMs;
    this.maxStepsPerFrame = options.maxStepsPerFrame;
  }

  setMode(mode: RuntimeMode): void {
    this.mode = mode;
    if (mode === "editorFrozen") this.accumulatorMs = 0;
  }

  pushDelta(deltaMs: number): ClockTick {
    if (this.mode === "editorFrozen") return { steps: 0, alpha: 0 };
    this.accumulatorMs += Math.max(0, deltaMs);
    let steps = 0;
    while (this.accumulatorMs >= this.fixedStepMs && steps < this.maxStepsPerFrame) {
      this.accumulatorMs -= this.fixedStepMs;
      this.frame += 1;
      this.timeMs += this.fixedStepMs;
      steps += 1;
    }
    if (steps === this.maxStepsPerFrame) this.accumulatorMs = 0;
    return { steps, alpha: this.accumulatorMs / this.fixedStepMs };
  }

  stepOnce(): ClockTick {
    this.frame += 1;
    this.timeMs += this.fixedStepMs;
    return { steps: 1, alpha: 0 };
  }

  captureState(): ClockState {
    return {
      frame: this.frame,
      timeMs: this.timeMs,
      accumulatorMs: this.accumulatorMs,
    };
  }

  restoreState(state: ClockState): void {
    this.frame = state.frame;
    this.timeMs = state.timeMs;
    this.accumulatorMs = state.accumulatorMs;
  }
}
