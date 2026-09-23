const SIDE = 10;
const STEER_SPEED = 680;
const KEY_SPEED = 520;

export const RACE_PLAYER_W = 34;
export const RACE_PLAYER_H = 28;
export const RACE_PLAYER_BOTTOM = 28;

export type RaceObstacleKind = 'rail' | 'bale';

export interface RaceObstacle {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: RaceObstacleKind;
}

export interface RaceState {
  playerX: number;
  distance: number;
  speed: number;
  obstacles: RaceObstacle[];
  alive: boolean;
  nextId: number;
  spawnIn: number;
  elapsed: number;
}

export interface RaceInput {
  pointerX: number | null;
  left: boolean;
  right: boolean;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function raceScore(state: RaceState) {
  return Math.floor(state.distance / 8);
}

export function raceCheer(score: number): 0 | 1 | 2 | 3 {
  if (score >= 200) return 3;
  if (score >= 100) return 2;
  if (score >= 40) return 1;
  return 0;
}

export function racePlayerBox(playerX: number, height: number) {
  const inset = 4;
  return {
    x: playerX - RACE_PLAYER_W / 2 + inset,
    y: height - RACE_PLAYER_BOTTOM - RACE_PLAYER_H + inset,
    w: RACE_PLAYER_W - inset * 2,
    h: RACE_PLAYER_H - inset * 2,
  };
}

function laneLimits(width: number) {
  const minX = SIDE + RACE_PLAYER_W / 2;
  const maxX = Math.max(minX, width - SIDE - RACE_PLAYER_W / 2);
  return { minX, maxX };
}

export function createRace(width: number): RaceState {
  const { minX, maxX } = laneLimits(width);
  return {
    playerX: clamp(width / 2, minX, maxX),
    distance: 0,
    speed: 120,
    obstacles: [],
    alive: true,
    nextId: 1,
    spawnIn: 200,
    elapsed: 0,
  };
}

function overlaps(player: { x: number; y: number; w: number; h: number }, obstacle: RaceObstacle) {
  const x = obstacle.x + 2;
  const y = obstacle.y + 2;
  const w = Math.max(0, obstacle.w - 4);
  const h = Math.max(0, obstacle.h - 4);
  return player.x < x + w && player.x + player.w > x && player.y < y + h && player.y + player.h > y;
}

export function raceDifficulty(elapsed: number) {
  const pressure = Math.min(1, Math.max(0, elapsed) / 36);
  const speed = 120 + pressure * 260;
  const wave = pressure < 0.28 ? 1 : pressure < 0.62 ? 2 : 3;
  return { pressure, speed, wave };
}

function nextObstacle(width: number, id: number, pressure: number, random: () => number): RaceObstacle {
  const kind: RaceObstacleKind = random() < 0.58 + pressure * 0.12 ? 'rail' : 'bale';
  const corridor = 64 - pressure * 16;
  const maxW = Math.max(24, width - SIDE * 2 - corridor);
  const desired = kind === 'rail'
    ? 28 + random() * width * (0.2 + pressure * 0.16)
    : 22 + random() * (14 + pressure * 10);
  const w = clamp(desired, 22, Math.min(maxW, width * (0.38 + pressure * 0.2)));
  const h = kind === 'rail' ? 12 : 18 + random() * 8;
  const span = Math.max(0, width - w - SIDE * 2);
  return { id, x: SIDE + random() * span, y: -h - 8, w, h, kind };
}

export function stepRace(
  state: RaceState,
  dtIn: number,
  input: RaceInput,
  width: number,
  height: number,
  random: () => number = Math.random,
): RaceState {
  if (!state.alive || width < 48 || height < 64) return state;
  const dt = Math.min(0.034, Math.max(0, dtIn));
  const { pressure, speed, wave } = raceDifficulty(state.elapsed);
  const distance = state.distance + speed * dt;
  const { minX, maxX } = laneLimits(width);

  let playerX = state.playerX;
  if (input.left !== input.right) {
    playerX += (input.right ? 1 : -1) * KEY_SPEED * dt;
  } else if (input.pointerX != null) {
    const delta = input.pointerX - playerX;
    playerX += Math.sign(delta) * Math.min(Math.abs(delta), STEER_SPEED * dt);
  }
  playerX = clamp(playerX, minX, maxX);

  let obstacles = state.obstacles
    .map((obstacle) => ({ ...obstacle, y: obstacle.y + speed * dt }))
    .filter((obstacle) => obstacle.y < height + 28);
  let nextId = state.nextId;
  let spawnIn = state.spawnIn - speed * dt;
  if (spawnIn <= 0) {
    const stagger = Math.max(88, speed * 0.32);
    const spawned = Array.from({ length: wave }, (_, index) => {
      const obstacle = nextObstacle(width, nextId + index, pressure, random);
      obstacle.y -= index * stagger;
      return obstacle;
    });
    obstacles = [...obstacles, ...spawned];
    nextId += wave;
    spawnIn = 176 - pressure * 64 + random() * 28;
  }

  const alive = !obstacles.some((obstacle) => overlaps(racePlayerBox(playerX, height), obstacle));
  return {
    playerX,
    distance,
    speed,
    obstacles,
    alive,
    nextId,
    spawnIn,
    elapsed: state.elapsed + dt,
  };
}
