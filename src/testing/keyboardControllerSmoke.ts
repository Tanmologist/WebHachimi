import { handleEditorKeyDown, handleEditorKeyUp } from "../editor/keyboardController";

type CapturedInput = {
  key: string;
  pressed: boolean;
};

const inputs: CapturedInput[] = [];
let toggles = 0;

const options = {
  isTypingTarget: () => false,
  onToggleRun: () => {
    toggles += 1;
  },
  setInput: (key: CapturedInput["key"], pressed: boolean) => {
    inputs.push({ key, pressed });
  },
};

handleEditorKeyDown(keyEvent("j"), options);
handleEditorKeyUp(keyEvent("j"), options);
handleEditorKeyDown(keyEvent("k"), options);
handleEditorKeyUp(keyEvent("k"), options);
const spaceDown = keyEvent(" ", "Space");
handleEditorKeyDown(spaceDown, options);
handleEditorKeyUp(keyEvent(" ", "Space"), options);
handleEditorKeyDown(keyEvent("z"), options);

assertInput("attack", true);
assertInput("attack", false);
assertInput("parry", true);
assertInput("parry", false);
assertInput("jump", true);
assert(spaceDown.defaultPrevented, "space should prevent browser scrolling");
assert(toggles === 1, `expected one run toggle, got ${toggles}`);

console.log(JSON.stringify({ status: "passed", inputs, toggles }, null, 2));

function keyEvent(key: string, code = ""): KeyboardEvent & { defaultPrevented: boolean } {
  return {
    key,
    code,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    target: null,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  } as KeyboardEvent & { defaultPrevented: boolean };
}

function assertInput(key: string, pressed: boolean): void {
  assert(inputs.some((input) => input.key === key && input.pressed === pressed), `missing input ${key}:${pressed}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
