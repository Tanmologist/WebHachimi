import type { RuntimeWorld } from "../runtime/world";

export type PlayerInputBinding = {
  destroy(): void;
};

export type PlayerInputKey = "left" | "right" | "jump" | "attack" | "parry";

const keyMap: Record<string, PlayerInputKey | undefined> = {
  ArrowLeft: "left",
  a: "left",
  A: "left",
  ArrowRight: "right",
  d: "right",
  D: "right",
  ArrowUp: "jump",
  w: "jump",
  W: "jump",
  " ": "jump",
  j: "attack",
  J: "attack",
  k: "parry",
  K: "parry",
};

export function playerInputKeyForMouseButton(button: number): Extract<PlayerInputKey, "attack" | "parry"> | undefined {
  if (button === 0) return "attack";
  if (button === 2) return "parry";
  return undefined;
}

export function bindPlayerInput(root: HTMLElement, world: RuntimeWorld): PlayerInputBinding {
  const pressedPointers = new Map<number, PlayerInputKey>();
  const pressedMouseButtons = new Map<number, PlayerInputKey>();
  const cleanup: Array<() => void> = [];

  const setInput = (key: PlayerInputKey, pressed: boolean) => {
    world.setInput(key, pressed);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const inputKey = keyMap[event.key];
    if (!inputKey || isTypingTarget(event.target)) return;
    event.preventDefault();
    setInput(inputKey, true);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const inputKey = keyMap[event.key];
    if (!inputKey || isTypingTarget(event.target)) return;
    event.preventDefault();
    setInput(inputKey, false);
  };

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp, { passive: false });
  cleanup.push(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  });

  const stage = root.querySelector<HTMLElement>('[data-role="stage"]') || root;
  const onMouseDown = (event: MouseEvent) => {
    const inputKey = playerInputKeyForMouseButton(event.button);
    if (!inputKey || isTypingTarget(event.target)) return;
    event.preventDefault();
    pressedMouseButtons.set(event.button, inputKey);
    setInput(inputKey, true);
  };
  const onMouseUp = (event: MouseEvent) => {
    const inputKey = pressedMouseButtons.get(event.button) || playerInputKeyForMouseButton(event.button);
    if (!inputKey) return;
    event.preventDefault();
    pressedMouseButtons.delete(event.button);
    setInput(inputKey, hasPressedInput(pressedMouseButtons, inputKey));
  };
  stage.addEventListener("mousedown", onMouseDown, { passive: false });
  window.addEventListener("mouseup", onMouseUp, { passive: false });
  cleanup.push(() => {
    stage.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
  });

  root.querySelectorAll<HTMLElement>("[data-input]").forEach((control) => {
    const inputKey = control.dataset.input as PlayerInputKey | undefined;
    if (!inputKey) return;

    const press = (event: PointerEvent) => {
      event.preventDefault();
      pressedPointers.set(event.pointerId, inputKey);
      control.setPointerCapture(event.pointerId);
      control.classList.add("is-pressed");
      setInput(inputKey, true);
    };
    const release = (event: PointerEvent) => {
      const activeKey = pressedPointers.get(event.pointerId);
      if (!activeKey) return;
      event.preventDefault();
      pressedPointers.delete(event.pointerId);
      control.classList.remove("is-pressed");
      setInput(activeKey, hasPressedInput(pressedPointers, activeKey));
      if (control.hasPointerCapture(event.pointerId)) control.releasePointerCapture(event.pointerId);
    };

    control.addEventListener("pointerdown", press, { passive: false });
    control.addEventListener("pointerup", release, { passive: false });
    control.addEventListener("pointercancel", release, { passive: false });
    control.addEventListener("lostpointercapture", release as EventListener, { passive: false });
    cleanup.push(() => {
      control.removeEventListener("pointerdown", press);
      control.removeEventListener("pointerup", release);
      control.removeEventListener("pointercancel", release);
      control.removeEventListener("lostpointercapture", release as EventListener);
    });
  });

  const stopContextMenu = (event: Event) => event.preventDefault();
  root.addEventListener("contextmenu", stopContextMenu);
  cleanup.push(() => root.removeEventListener("contextmenu", stopContextMenu));

  return {
    destroy() {
      cleanup.forEach((dispose) => dispose());
      pressedPointers.clear();
      pressedMouseButtons.clear();
      setInput("left", false);
      setInput("right", false);
      setInput("jump", false);
      setInput("attack", false);
      setInput("parry", false);
    },
  };
}

function hasPressedInput(inputs: Map<number, PlayerInputKey>, key: PlayerInputKey): boolean {
  for (const value of inputs.values()) {
    if (value === key) return true;
  }
  return false;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
