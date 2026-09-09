import { describe, expect, it } from 'vitest';
import { atmosphereParticleCount, createAtmosphereParticles, normalizeAtmosphere, stepAtmosphereParticles } from '@/lib/atmosphere';

describe('atmosphere particles', () => {
  it('only spawns particles when atmosphere is on without reduced motion', () => {
    expect(atmosphereParticleCount('forge', 'on', false)).toBe(42);
    expect(atmosphereParticleCount('ink', 'on', false)).toBe(14);
    expect(atmosphereParticleCount('mono', 'on', false)).toBe(0);
    expect(atmosphereParticleCount('aurora', 'off', false)).toBe(0);
    expect(atmosphereParticleCount('ocean', 'on', true)).toBe(0);
  });

  it('maps legacy low and high values to on', () => {
    expect(normalizeAtmosphere('off')).toBe('off');
    expect(normalizeAtmosphere('on')).toBe('on');
    expect(normalizeAtmosphere('low')).toBe('on');
    expect(normalizeAtmosphere('high')).toBe('on');
    expect(normalizeAtmosphere(undefined)).toBe('on');
  });

  it('keeps the particle count after stepping', () => {
    const particles = createAtmosphereParticles('aurora', 800, 600, 42);
    expect(particles).toHaveLength(42);
    stepAtmosphereParticles(particles, 'aurora', 800, 600, 0.032);
    expect(particles).toHaveLength(42);
  });
});
