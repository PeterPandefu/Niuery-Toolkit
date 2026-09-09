import type { PointerEffect, SkinId } from '@/types/tool';

export const POINTER_EFFECT_IDS: PointerEffect[] = ['off', 'tassel', 'glow'];
export const DEFAULT_POINTER_EFFECT: PointerEffect = 'glow';
export const MAX_POINTER_MOTIFS = 22;
export const POINTER_REST_DISTANCE = 1.25;
export const MOTIF_SPACING_SLOW = 30;
export const MOTIF_SPACING_FAST = 14;

export function isPointerEffect(value: unknown): value is PointerEffect {
  return POINTER_EFFECT_IDS.includes(value as PointerEffect);
}

export function normalizePointerEffect(value: unknown): PointerEffect {
  return isPointerEffect(value) ? value : DEFAULT_POINTER_EFFECT;
}

export type PointerMotifKind = 'ember' | 'drop' | 'leaf' | 'mote' | 'seal';

export interface MagicSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  seed: number;
  phase: number;
  kind: PointerMotifKind;
  hue: number | null;
  generation: number;
  branched: boolean;
}

export interface MagicTassel {
  sparks: MagicSpark[];
  head: { x: number; y: number };
  lastSpawn: { x: number; y: number };
  speed: number;
}

export function createMagicTassel(x: number, y: number): MagicTassel {
  return { sparks: [], head: { x, y }, lastSpawn: { x, y }, speed: 0 };
}

/** 慢速拉开间距，快速才加密，避免小范围晃动挤成一团。 */
export function motifSpacing(speed: number) {
  const t = Math.min(1, Math.max(0, speed / 1800));
  return MOTIF_SPACING_SLOW - t * (MOTIF_SPACING_SLOW - MOTIF_SPACING_FAST);
}

export function motifSpawnCount(travel: number, speed: number) {
  const spacing = motifSpacing(speed);
  if (travel < spacing) return 0;
  return Math.min(3, Math.floor(travel / spacing));
}

export function motifKindForSkin(skin: SkinId): PointerMotifKind {
  if (skin === 'ocean') return 'drop';
  if (skin === 'forest') return 'leaf';
  if (skin === 'aurora') return 'mote';
  if (skin === 'ink') return 'seal';
  return 'ember';
}

/** 图形寿命：快亮、稳住、再减速淡出。 */
export function starLifeAlpha(progress: number) {
  const t = Math.min(1, Math.max(0, progress));
  if (t < 0.18) {
    const rise = t / 0.18;
    return 1 - (1 - rise) * (1 - rise);
  }
  if (t > 0.58) {
    const fall = (t - 0.58) / 0.42;
    return Math.max(0, (1 - fall) * (1 - fall));
  }
  return 1;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function spawnMotif(skin: SkinId, x: number, y: number, dirX: number, dirY: number, speed: number, along = 1): MagicSpark {
  const kind = motifKindForSkin(skin);
  const tail = 1 - along;
  const perpX = -dirY;
  const perpY = dirX;
  const spread = (10 + tail * 26 + Math.min(speed / 110, 16)) * (Math.random() - 0.5);
  const trail = Math.min(speed * 0.05, 32);
  let size = 1.4 + Math.random() * 1.6;
  let hue: number | null = null;
  const vx = -dirX * trail * 0.45 + perpX * spread * 1.35 + (Math.random() - 0.5) * 10;
  let vy = -dirY * trail * 0.45 + perpY * spread * 1.35 + (Math.random() - 0.5) * 10;

  if (kind === 'ember') {
    size = 1.5 + Math.random() * 2.2;
    vy -= randomBetween(8, 22);
    hue = randomBetween(16, 28);
  } else if (kind === 'drop') {
    size = 2.4 + Math.random() * 3.2;
    vy -= randomBetween(4, 12);
    hue = randomBetween(186, 198);
  } else if (kind === 'leaf') {
    size = 2.8 + Math.random() * 3.4;
    vy += randomBetween(10, 22);
    hue = randomBetween(90, 140);
  } else if (kind === 'mote') {
    size = 1.8 + Math.random() * 2.6;
    hue = Math.random() > 0.5 ? randomBetween(165, 180) : randomBetween(255, 275);
  } else {
    size = 1.1 + Math.random() * 1.6;
    hue = Math.random() > 0.45 ? randomBetween(4, 14) : randomBetween(28, 40);
  }

  return {
    x: x - dirX * trail * 0.2 + perpX * spread,
    y: y - dirY * trail * 0.2 + perpY * spread,
    vx,
    vy,
    life: 0,
    maxLife: 0.3 + Math.random() * 0.24,
    size,
    seed: Math.random(),
    phase: Math.random() * Math.PI * 2,
    kind,
    hue,
    generation: 0,
    branched: false,
  };
}

export function stepMagicTassel(
  tassel: MagicTassel,
  targetX: number,
  targetY: number,
  deltaSeconds: number,
  skin: SkinId = 'forge'
) {
  const dt = Math.min(Math.max(deltaSeconds, 0), 0.048);
  const dx = targetX - tassel.head.x;
  const dy = targetY - tassel.head.y;
  const distance = Math.hypot(dx, dy);
  const moving = distance > POINTER_REST_DISTANCE;
  tassel.speed = moving ? distance / Math.max(dt, 0.008) : 0;

  const follow = Math.min(1, dt * 22);
  tassel.head.x += dx * follow;
  tassel.head.y += dy * follow;

  if (skin !== 'mono' && moving) {
    const travel = Math.hypot(tassel.head.x - tassel.lastSpawn.x, tassel.head.y - tassel.lastSpawn.y);
    const count = Math.min(motifSpawnCount(travel, tassel.speed), MAX_POINTER_MOTIFS - tassel.sparks.length);
    if (count > 0) {
      const spanX = tassel.head.x - tassel.lastSpawn.x;
      const spanY = tassel.head.y - tassel.lastSpawn.y;
      const inv = travel || 1;
      const dirX = spanX / inv;
      const dirY = spanY / inv;
      for (let index = 1; index <= count; index += 1) {
        const t = index / count;
        tassel.sparks.push(
          spawnMotif(skin, tassel.lastSpawn.x + spanX * t, tassel.lastSpawn.y + spanY * t, dirX, dirY, tassel.speed, t)
        );
      }
      tassel.lastSpawn = { x: tassel.head.x, y: tassel.head.y };
    }
  }

  const decay = moving ? 1 : 2.6;
  const branches: MagicSpark[] = [];
  for (let index = tassel.sparks.length - 1; index >= 0; index -= 1) {
    const spark = tassel.sparks[index];
    spark.life += dt * decay;
    spark.phase += dt * (2.2 + spark.seed * 1.8);
    spark.x += spark.vx * dt;
    spark.y += spark.vy * dt;
    spark.vx *= 0.9;
    spark.vy *= 0.9;
    if (spark.kind === 'leaf') spark.phase += dt * 1.6;

    const progress = spark.life / spark.maxLife;
    if (
      moving &&
      skin !== 'mono' &&
      spark.generation === 0 &&
      !spark.branched &&
      progress > 0.3 &&
      progress < 0.68 &&
      spark.seed > 0.52 &&
      tassel.sparks.length + branches.length < MAX_POINTER_MOTIFS
    ) {
      spark.branched = true;
      const speed = Math.hypot(spark.vx, spark.vy);
      const inv = speed || 1;
      const child = spawnMotif(skin, spark.x, spark.y, spark.vx / inv, spark.vy / inv, Math.max(120, tassel.speed * 0.45), 0);
      child.generation = 1;
      child.size *= 0.62;
      child.maxLife *= 0.55;
      branches.push(child);
    }

    if (spark.life >= spark.maxLife) tassel.sparks.splice(index, 1);
  }
  if (branches.length > 0) tassel.sparks.push(...branches);
}

function fillColor(ember: string, hue: number | null, alpha: number) {
  if (hue === null) return `hsl(${ember} / ${alpha})`;
  return `hsl(${hue} 70% 62% / ${alpha})`;
}

function drawMotif(context: CanvasRenderingContext2D, spark: MagicSpark, ember: string, alpha: number) {
  if (alpha <= 0.02) return;
  const color = fillColor(ember, spark.hue, alpha);
  context.save();
  context.translate(spark.x, spark.y);
  context.rotate(spark.phase * (spark.kind === 'leaf' ? 0.7 : 0.15));

  if (spark.kind === 'leaf') {
    context.fillStyle = color;
    context.beginPath();
    context.ellipse(0, 0, spark.size * 1.15, spark.size * 0.48, 0, 0, Math.PI * 2);
    context.fill();
  } else if (spark.kind === 'seal') {
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, spark.size * 1.8);
    glow.addColorStop(0, fillColor(ember, spark.hue, alpha * 0.9));
    glow.addColorStop(1, fillColor(ember, spark.hue, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, spark.size * 1.8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = color;
    context.fillRect(-spark.size * 0.5, -spark.size * 0.5, spark.size, spark.size);
  } else if (spark.kind === 'drop') {
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, spark.size * 1.7);
    glow.addColorStop(0, fillColor(ember, spark.hue, Math.min(0.7, alpha)));
    glow.addColorStop(0.55, fillColor(ember, spark.hue, alpha * 0.28));
    glow.addColorStop(1, fillColor(ember, spark.hue, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, spark.size * 1.7, 0, Math.PI * 2);
    context.fill();
  } else {
    const glow = context.createRadialGradient(0, 0, 0, 0, 0, spark.size * 1.8);
    glow.addColorStop(0, fillColor(ember, spark.hue, Math.min(0.78, alpha)));
    glow.addColorStop(1, fillColor(ember, spark.hue, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, spark.size * 1.8, 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

export function drawMagicTassel(
  context: CanvasRenderingContext2D,
  tassel: MagicTassel,
  ember: string,
  alpha: number,
  _skin: SkinId = 'forge'
) {
  if (alpha <= 0.01) return;

  for (const spark of tassel.sparks) {
    const fade = starLifeAlpha(spark.life / spark.maxLife);
    drawMotif(context, spark, ember, alpha * fade);
  }
}
