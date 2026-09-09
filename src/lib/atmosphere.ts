import type { AtmosphereIntensity, SkinId } from '@/types/tool';

export const ATMOSPHERE_IDS: AtmosphereIntensity[] = ['off', 'low', 'high'];
export const DEFAULT_ATMOSPHERE: AtmosphereIntensity = 'low';

export function isAtmosphereIntensity(value: unknown): value is AtmosphereIntensity {
  return ATMOSPHERE_IDS.includes(value as AtmosphereIntensity);
}

export interface AtmosphereParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  hue: number;
  phase: number;
}

export function atmosphereParticleCount(skin: SkinId, atmosphere: AtmosphereIntensity, reducedMotion: boolean) {
  if (atmosphere !== 'high' || reducedMotion || skin === 'mono') return 0;
  if (skin === 'ink') return 14;
  return 42;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function createAtmosphereParticles(skin: SkinId, width: number, height: number, count: number): AtmosphereParticle[] {
  return Array.from({ length: count }, () => spawnParticle(skin, width, height, true));
}

function spawnParticle(skin: SkinId, width: number, height: number, scatter: boolean): AtmosphereParticle {
  const x = Math.random() * Math.max(width, 1);
  const y = scatter ? Math.random() * Math.max(height, 1) : spawnOriginY(skin, height);
  if (skin === 'forge') {
    return { x, y, vx: randomBetween(-10, 10), vy: randomBetween(-36, -16), size: randomBetween(1.6, 3.4), alpha: randomBetween(0.45, 0.9), hue: randomBetween(16, 28), phase: Math.random() * Math.PI * 2 };
  }
  if (skin === 'ocean') {
    return { x, y, vx: randomBetween(-8, 8), vy: randomBetween(-22, -8), size: randomBetween(2.4, 6), alpha: randomBetween(0.28, 0.55), hue: randomBetween(186, 198), phase: Math.random() * Math.PI * 2 };
  }
  if (skin === 'forest') {
    return { x, y, vx: randomBetween(-12, 12), vy: randomBetween(16, 30), size: randomBetween(3, 7), alpha: randomBetween(0.32, 0.6), hue: randomBetween(90, 140), phase: Math.random() * Math.PI * 2 };
  }
  if (skin === 'aurora') {
    return { x, y, vx: randomBetween(-18, 18), vy: randomBetween(-10, 10), size: randomBetween(2, 5), alpha: randomBetween(0.35, 0.7), hue: Math.random() > 0.5 ? randomBetween(165, 180) : randomBetween(255, 275), phase: Math.random() * Math.PI * 2 };
  }
  return { x, y, vx: randomBetween(-5, 5), vy: randomBetween(-7, 7), size: randomBetween(1, 2.2), alpha: randomBetween(0.2, 0.4), hue: randomBetween(30, 40), phase: Math.random() * Math.PI * 2 };
}

function spawnOriginY(skin: SkinId, height: number) {
  if (skin === 'forge' || skin === 'ocean') return height + 8;
  if (skin === 'forest') return -8;
  return Math.random() * Math.max(height, 1);
}

export function stepAtmosphereParticles(particles: AtmosphereParticle[], skin: SkinId, width: number, height: number, deltaSeconds: number) {
  const dt = Math.min(deltaSeconds, 0.048);
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index];
    particle.phase += dt;
    particle.x += (particle.vx + Math.sin(particle.phase) * swayFor(skin)) * dt;
    particle.y += particle.vy * dt;
    if (skin === 'aurora') particle.alpha = 0.18 + Math.sin(particle.phase * 1.4) * 0.16;
    const outOfBounds = particle.x < -24 || particle.x > width + 24 || particle.y < -24 || particle.y > height + 24;
    if (outOfBounds) particles[index] = spawnParticle(skin, width, height, false);
  }
}

function swayFor(skin: SkinId) {
  if (skin === 'forest') return 18;
  if (skin === 'ocean') return 10;
  if (skin === 'aurora') return 22;
  return 6;
}

export function drawAtmosphereParticles(context: CanvasRenderingContext2D, particles: AtmosphereParticle[], skin: SkinId) {
  for (const particle of particles) {
    context.save();
    context.globalAlpha = Math.max(particle.alpha, 0);
    context.fillStyle = `hsl(${particle.hue} 70% 62%)`;
    context.translate(particle.x, particle.y);
    if (skin === 'forest') {
      context.rotate(particle.phase * 0.4);
      context.fillRect(-particle.size, -particle.size / 2, particle.size * 2, particle.size);
    } else {
      context.beginPath();
      context.arc(0, 0, particle.size, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}
