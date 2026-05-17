import { normalizeSceneTimeScale } from "../project/schema";

export const WORLD_SPEED_LIMITS = {
  min: 0,
  max: 4,
  step: 0.05,
} as const;

export type WorldSpeedControlElements = {
  control: HTMLElement;
  range: HTMLInputElement;
  input: HTMLInputElement;
  valueNode: HTMLElement;
  presetButtons: HTMLButtonElement[];
};

export type WorldSpeedControlState = {
  sceneId: string;
  speed: number;
  mode: string;
};

export function normalizeWorldSpeed(value: number): number {
  return normalizeSceneTimeScale(value);
}

export function parseWorldSpeedInput(rawValue: string): number | undefined {
  const text = rawValue.trim();
  if (!text) return undefined;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return undefined;
  return normalizeWorldSpeed(numeric);
}

export function formatWorldSpeed(value: number): string {
  const normalized = normalizeWorldSpeed(value);
  return `${Number.isInteger(normalized) ? normalized.toFixed(0) : normalized.toFixed(2).replace(/0$/, "")}x`;
}

export function worldSpeedControlSignature(state: WorldSpeedControlState): string {
  return `${state.sceneId}|${normalizeWorldSpeed(state.speed)}|${state.mode}`;
}

export function renderWorldSpeedControlElements(
  elements: WorldSpeedControlElements,
  state: WorldSpeedControlState,
  options: { preserveInput?: boolean } = {},
): void {
  const speed = normalizeWorldSpeed(state.speed);
  const controlValue = String(speed);
  const isRunning = state.mode === "game";
  elements.control.hidden = !isRunning;
  elements.control.setAttribute("aria-hidden", String(!isRunning));
  elements.control.dataset.worldSpeed = controlValue;
  elements.valueNode.textContent = formatWorldSpeed(speed);
  elements.range.min = String(WORLD_SPEED_LIMITS.min);
  elements.range.max = String(WORLD_SPEED_LIMITS.max);
  elements.range.step = String(WORLD_SPEED_LIMITS.step);
  elements.range.value = controlValue;
  elements.range.setAttribute("aria-valuetext", formatWorldSpeed(speed));
  elements.input.min = String(WORLD_SPEED_LIMITS.min);
  elements.input.max = String(WORLD_SPEED_LIMITS.max);
  elements.input.step = String(WORLD_SPEED_LIMITS.step);
  if (!options.preserveInput) elements.input.value = controlValue;
  elements.presetButtons.forEach((button) => {
    const preset = parseWorldSpeedInput(button.dataset.worldSpeedPreset || "");
    const isActive = preset !== undefined && Math.abs(preset - speed) < 0.001;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}
