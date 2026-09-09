import { useEffect, useRef } from 'react';
import { atmosphereParticleCount, createAtmosphereParticles, drawAtmosphereParticles, stepAtmosphereParticles } from '@/lib/atmosphere';
import { createMagicTassel, DEFAULT_POINTER_EFFECT, drawMagicTassel, stepMagicTassel, type MagicTassel } from '@/lib/pointer-effect';
import { useAppStore } from '@/store/app-store';
import { cn } from '@/lib/utils';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const atmosphereExcludeSelector = '.monaco-editor, .monaco-diff-editor, canvas:not(.atmosphere-layer), [data-atmosphere-exclude]';

function subscribeReducedMotion(callback: () => void) {
  const mediaQuery = window.matchMedia(reducedMotionQuery);
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

interface AtmosphereLayerProps {
  density?: 'full' | 'narrow';
  pointerGlow?: boolean;
}

/** 根层指针装饰覆盖全窗；侧栏与工作台层只绘制粒子。 */
export function AtmosphereLayer({ density = 'full', pointerGlow = false }: AtmosphereLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0, y: 0, inside: false, seen: false });
  const skin = useAppStore((state) => state.skin);
  const atmosphere = useAppStore((state) => state.atmosphere);
  const pointerEffect = useAppStore((state) => state.pointerEffect) ?? DEFAULT_POINTER_EFFECT;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    let frame = 0;
    let previous = performance.now();
    let width = 0;
    let height = 0;
    let particles = createAtmosphereParticles(skin, 1, 1, 0);
    let tassel: MagicTassel | null = null;
    let tasselAlpha = 0;
    let reducedMotion = window.matchMedia(reducedMotionQuery).matches;

    const particleScale = density === 'narrow' ? 0.45 : 1;
    const enableGlow = pointerGlow && pointerEffect === 'glow' && skin !== 'mono';
    const enableTassel = pointerGlow && pointerEffect === 'tassel' && skin !== 'mono';
    const enableParticles = !pointerGlow && atmosphere === 'on' && skin !== 'mono';
    const glowRadius = 120;
    const glowAlpha = 0.08;

    const syncPointer = (event: PointerEvent) => {
      if (!enableGlow && !enableTassel) return;
      const rect = canvas.getBoundingClientRect();
      const target = event.target;
      const excluded = target instanceof Element && Boolean(target.closest(atmosphereExcludeSelector));
      pointerRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        inside: !excluded,
        seen: true,
      };
    };

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const bounds = pointerGlow ? { width: window.innerWidth, height: window.innerHeight } : parent.getBoundingClientRect();
      width = Math.max(1, Math.floor(bounds.width));
      height = Math.max(1, Math.floor(bounds.height));
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const count = enableParticles
        ? Math.round(atmosphereParticleCount(skin, atmosphere, reducedMotion) * particleScale)
        : 0;
      particles = createAtmosphereParticles(skin, width, height, count);
    };

    const readEmber = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--ember-glow').trim() || '16 70% 42%';

    const drawPointerGlow = () => {
      if (!enableGlow || reducedMotion || !pointerRef.current.inside) return;
      const { x, y } = pointerRef.current;
      const ember = readEmber();
      const glow = context.createRadialGradient(x, y, 0, x, y, glowRadius);
      glow.addColorStop(0, `hsl(${ember} / ${glowAlpha})`);
      glow.addColorStop(0.4, `hsl(${ember} / ${glowAlpha * 0.4})`);
      glow.addColorStop(1, `hsl(${ember} / 0)`);
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);
    };

    const drawPointerTassel = (delta: number) => {
      if (!enableTassel || reducedMotion || !pointerRef.current.seen) return;
      const { x, y, inside } = pointerRef.current;
      tassel ??= createMagicTassel(x, y);
      tasselAlpha += ((inside ? 1 : 0) - tasselAlpha) * Math.min(1, delta * 8);
      stepMagicTassel(tassel, x, y, delta, skin);
      drawMagicTassel(context, tassel, readEmber(), tasselAlpha, skin);
    };

    const tick = (now: number) => {
      const delta = (now - previous) / 1000;
      previous = now;
      context.clearRect(0, 0, width, height);
      drawPointerGlow();
      drawPointerTassel(delta);
      if (particles.length > 0 && !document.hidden) {
        stepAtmosphereParticles(particles, skin, width, height, delta);
        drawAtmosphereParticles(context, particles, skin);
      }
      frame = window.requestAnimationFrame(tick);
    };

    const startLoop = () => {
      window.cancelAnimationFrame(frame);
      const shouldAnimate = !reducedMotion && (enableGlow || enableTassel || enableParticles);
      if (shouldAnimate) {
        previous = performance.now();
        frame = window.requestAnimationFrame(tick);
      } else {
        context.clearRect(0, 0, width, height);
      }
    };

    const syncMotion = () => {
      reducedMotion = window.matchMedia(reducedMotionQuery).matches;
      resize();
      startLoop();
    };

    resize();
    startLoop();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);
    if (enableGlow || enableTassel) {
      window.addEventListener('pointermove', syncPointer, { passive: true });
    }
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', syncMotion);
    const unsubscribe = subscribeReducedMotion(syncMotion);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', syncPointer);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', syncMotion);
      unsubscribe();
    };
  }, [atmosphere, density, pointerEffect, pointerGlow, skin]);

  if (pointerGlow) {
    if (pointerEffect === 'off' || skin === 'mono') return null;
  } else if (atmosphere === 'off') {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      className={cn(
        'atmosphere-layer pointer-events-none',
        pointerGlow ? 'fixed inset-0 z-[30]' : 'absolute inset-0 -z-[1] h-full w-full'
      )}
      aria-hidden="true"
    />
  );
}
