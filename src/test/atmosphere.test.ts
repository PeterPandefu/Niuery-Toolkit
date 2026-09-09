import { describe, expect, it } from 'vitest';
import { atmosphereParticleCount, createAtmosphereParticles, stepAtmosphereParticles } from '@/lib/atmosphere';

describe('atmosphere particles', () => {
  it('only spawns particles at high intensity without reduced motion', () => {
    expect(atmosphereParticleCount('forge', 'high', false)).toBe(42);
    expect(atmosphereParticleCount('ink', 'high', false)).toBe(14);
    expect(atmosphereParticleCount('mono', 'high', false)).toBe(0);
    expect(atmosphereParticleCount('aurora', 'low', false)).toBe(0);
    expect(atmosphereParticleCount('ocean', 'high', true)).toBe(0);
  });

  it('keeps the particle count after stepping', () => {
    const particles = createAtmosphereParticles('aurora', 800, 600, 42);
    expect(particles).toHaveLength(42);
    stepAtmosphereParticles(particles, 'aurora', 800, 600, 0.032);
    expect(particles).toHaveLength(42);
  });
});
