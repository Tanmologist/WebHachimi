export type KeyboardControllerOptions = {
  isTypingTarget: (target: EventTarget | null) => boolean;
  onToggleRun: () => void;
  setInput: (key: "left" | "right" | "jump", pressed: boolean) => void;
};

export function handleEditorKeyDown(event: KeyboardEvent, options: KeyboardControllerOptions): void {
  if (options.isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "z") {
    event.preventDefault();
    if (event.repeat) return;
    options.onToggleRun();
    return;
  }
  if (event.key === "ArrowLeft" || key === "a") options.setInput("left", true);
  if (event.key === "ArrowRight" || key === "d") options.setInput("right", true);
  if (event.key === " " || key === "w") {
    event.preventDefault();
    options.setInput("jump", true);
  }
}

export function handleEditorKeyUp(event: KeyboardEvent, options: KeyboardControllerOptions): void {
  if (options.isTypingTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (event.key === "ArrowLeft" || key === "a") options.setInput("left", false);
  if (event.key === "ArrowRight" || key === "d") options.setInput("right", false);
  if (event.key === " " || key === "w") {
    event.preventDefault();
    options.setInput("jump", false);
  }
}
