import { describe, expect, it } from 'vitest';
import {
  createMagicTassel,
  MAX_POINTER_MOTIFS,
  motifKindForSkin,
  motifSpacing,
  motifSpawnCount,
  normalizePointerEffect,
  starLifeAlpha,
  stepMagicTassel,
} from '@/lib/pointer-effect';

describe('pointer effect', () => {
  it('keeps unknown values as glow', () => {
    expect(normalizePointerEffect('glow')).toBe('glow');
    expect(normalizePointerEffect('tassel')).toBe('tassel');
    expect(normalizePointerEffect('off')).toBe('off');
    expect(normalizePointerEffect('high')).toBe('glow');
    expect(normalizePointerEffect(undefined)).toBe('glow');
  });

  it('maps each skin to its motif', () => {
    expect(motifKindForSkin('forge')).toBe('ember');
    expect(motifKindForSkin('ocean')).toBe('drop');
    expect(motifKindForSkin('forest')).toBe('leaf');
    expect(motifKindForSkin('aurora')).toBe('mote');
    expect(motifKindForSkin('ink')).toBe('seal');
    expect(motifKindForSkin('mono')).toBe('ember');
  });

  it('spaces motifs farther apart when slow', () => {
    expect(motifSpacing(80)).toBeGreaterThan(motifSpacing(1600));
    expect(motifSpawnCount(8, 400)).toBe(0);
    expect(motifSpawnCount(80, 1600)).toBeGreaterThan(motifSpawnCount(24, 200));
  });

  it('does not spawn motifs while the pointer is still', () => {
    const tassel = createMagicTassel(120, 80);
    for (let step = 0; step < 24; step += 1) {
      stepMagicTassel(tassel, 120, 80, 0.016, 'forge');
    }
    expect(tassel.sparks).toHaveLength(0);
    expect(tassel.speed).toBe(0);
  });

  it('does not clump motifs during small-range wobble', () => {
    const tassel = createMagicTassel(100, 100);
    for (let step = 0; step < 48; step += 1) {
      const wobble = step % 2 === 0 ? 4 : -4;
      stepMagicTassel(tassel, 100 + wobble, 100, 0.016, 'forge');
    }
    expect(tassel.sparks.length).toBeLessThanOrEqual(2);
  });

  it('spawns skin motifs along a long stroke, then lets them fade when still', () => {
    const tassel = createMagicTassel(40, 40);
    for (let step = 0; step < 24; step += 1) {
      stepMagicTassel(tassel, 40 + step * 28, 40, 0.016, 'forest');
    }
    expect(tassel.sparks.length).toBeGreaterThan(0);
    expect(tassel.sparks.length).toBeLessThanOrEqual(MAX_POINTER_MOTIFS);
    expect(tassel.sparks.every((spark) => spark.kind === 'leaf')).toBe(true);

    const movingCount = tassel.sparks.length;
    for (let step = 0; step < 40; step += 1) {
      stepMagicTassel(tassel, tassel.head.x, tassel.head.y, 0.016, 'forest');
    }
    expect(tassel.sparks.length).toBeLessThan(movingCount);
    expect(tassel.sparks.length).toBe(0);
  });

  it('adds a few extra motifs from the tail while moving', () => {
    const tassel = createMagicTassel(40, 40);
    for (let step = 0; step < 36; step += 1) {
      stepMagicTassel(tassel, 40 + step * 28, 40, 0.016, 'forge');
    }
    expect(tassel.sparks.some((spark) => spark.generation === 1)).toBe(true);
  });

  it('does not spawn motifs for mono', () => {
    const tassel = createMagicTassel(40, 40);
    for (let step = 0; step < 16; step += 1) {
      stepMagicTassel(tassel, 40 + step * 20, 40, 0.016, 'mono');
    }
    expect(tassel.sparks).toHaveLength(0);
  });

  it('fades motifs in quickly and out more slowly', () => {
    expect(starLifeAlpha(0)).toBe(0);
    expect(starLifeAlpha(0.12)).toBeGreaterThan(0.5);
    expect(starLifeAlpha(0.35)).toBe(1);
    expect(starLifeAlpha(0.8)).toBeGreaterThan(0);
    expect(starLifeAlpha(0.8)).toBeLessThan(starLifeAlpha(0.6));
    expect(starLifeAlpha(1)).toBeCloseTo(0);
  });
});
