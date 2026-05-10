import type { Vec2 } from "../shared/types";

export type PlayerCameraScreen = {
  width: number;
  height: number;
};

export type PlayerCameraLayout = {
  x: number;
  y: number;
  scale: number;
};

export const PLAYER_WORLD_SCALE = 1;

export function playerCameraLayout(screen: PlayerCameraScreen, camera: Vec2): PlayerCameraLayout {
  return {
    x: screen.width / 2 - camera.x * PLAYER_WORLD_SCALE,
    y: screen.height * 0.55 - camera.y * PLAYER_WORLD_SCALE,
    scale: PLAYER_WORLD_SCALE,
  };
}
