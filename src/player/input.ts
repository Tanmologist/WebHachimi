import type { RuntimeWorld } from "../runtime/world";

export type PlayerInputBinding = {
  destroy(): void;
};

type InputKey = "left" | "right" | "jump";

const keyMap: Record<string, InputKey | undefined> = {
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
};

export function bindPlayerInput(root: HTMLElement, world: RuntimeWorld): PlayerInputBinding {
  const pressedPointers = new Map<number, InputKey>();
  const cleanup: Array<() => void> = [];

  const setInput = (key: InputKey, pressed: boolean) => {
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

  root.querySelectorAll<HTMLElement>("[data-input]").forEach((control) => {
    const inputKey = control.dataset.input as InputKey | undefined;
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
      setInput(activeKey, hasPressedPointer(pressedPointers, activeKey));
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
      setInput("left", false);
      setInput("right", false);
      setInput("jump", false);
    },
  };
}

function hasPressedPointer(pointers: Map<number, InputKey>, key: InputKey): boolean {
  for (const value of pointers.values()) {
    if (value === key) return true;
  }
  return false;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
