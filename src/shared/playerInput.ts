// Owns player-control input vocabulary and device-to-action mapping shared by
// player runtime bindings, editor play-mode forwarding, and input smoke tests.
// DOM event wiring stays in platform modules; this mapper is pure and reusable.

export type PlayerInputKey = "left" | "right" | "jump" | "attack" | "parry" | "dodge";

export type CombatMouseInputKey = Extract<PlayerInputKey, "attack" | "parry">;

const playerInputKeys = ["left", "right", "jump", "attack", "parry", "dodge"] as const satisfies readonly PlayerInputKey[];

const defaultKeyboardMap: Record<string, PlayerInputKey | undefined> = {
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
  Shift: "dodge",
  l: "dodge",
  L: "dodge",
};

export class PlayerInputMapper {
  constructor(private readonly keyboardMap: Readonly<Record<string, PlayerInputKey | undefined>> = defaultKeyboardMap) {}

  allKeys(): readonly PlayerInputKey[] {
    return playerInputKeys;
  }

  keyForKeyboardKey(key: string): PlayerInputKey | undefined {
    return this.keyboardMap[key];
  }

  keyForMouseButton(button: number): CombatMouseInputKey | undefined {
    if (button === 0) return "attack";
    if (button === 2) return "parry";
    return undefined;
  }
}

export const defaultPlayerInputMapper = new PlayerInputMapper();

export function playerInputKeyForKeyboardKey(key: string): PlayerInputKey | undefined {
  return defaultPlayerInputMapper.keyForKeyboardKey(key);
}

export function playerInputKeyForMouseButton(button: number): CombatMouseInputKey | undefined {
  return defaultPlayerInputMapper.keyForMouseButton(button);
}
