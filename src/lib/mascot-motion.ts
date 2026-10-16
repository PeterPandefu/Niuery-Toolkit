export const MASCOT_IDLE_MS = 30_000;
const FALL_GRAVITY = 3400;
const FLOAT_SPEED = 46;

export function stepFall(y: number, velocity: number, floor: number, dt: number) {
  const step = Math.min(Math.max(dt, 0), 0.034);
  const nextVelocity = velocity + FALL_GRAVITY * step;
  const nextY = y + nextVelocity * step;
  if (nextY >= floor) return { y: floor, velocity: 0, landed: true };
  return { y: nextY, velocity: nextVelocity, landed: false };
}

export function stepFloat(y: number, ceiling: number, dt: number) {
  const step = Math.min(Math.max(dt, 0), 0.034);
  const nextY = Math.max(ceiling, y - FLOAT_SPEED * step);
  return { y: nextY, arrived: nextY <= ceiling + 0.4 };
}

export function driftDuration(distance: number) {
  return Math.max(2.2, Math.abs(distance) / 76);
}

/** 从顶部平滑落到地板：纵向 ease-in-out，横向正弦摇晃，落地时摇晃归零。 */
export function stepDrift(startY: number, floor: number, elapsed: number, duration: number, amplitude: number) {
  const t = Math.min(1, Math.max(0, elapsed / Math.max(duration, 0.001)));
  const eased = t * t * (3 - 2 * t);
  const envelope = Math.sin(Math.PI * t);
  return {
    x: Math.sin(elapsed * 1.15) * amplitude * envelope,
    y: startY + (floor - startY) * eased,
    done: t >= 1,
  };
}
