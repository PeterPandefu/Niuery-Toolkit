import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { MascotCorner } from '@/components/mascot/MascotCorner';
import { MascotRace } from '@/components/mascot/MascotRace';
import { resolveBubbleShift } from '@/lib/mascot-bubble';
import { followMascotBounds, MASCOT_EDGE_INSET, mascotHomeX, REST_MASCOT_PLACEMENT, resolveMascotDrag, type MascotBounds, type MascotPlacement } from '@/lib/mascot-bounds';
import { mascotCornerVisible } from '@/lib/mascot-corner';
import { MASCOT_BUBBLE_MS, MASCOT_LINE_KEYS, MASCOT_PLAY_LINE, pickMascotLine } from '@/lib/mascot-lines';
import { MASCOT_IDLE_MS, driftDuration, stepDrift, stepFall, stepFloat } from '@/lib/mascot-motion';
import { cn } from '@/lib/utils';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const LINES = MASCOT_LINE_KEYS;
const POSES = ['perk', 'wink', 'nod'] as const;
const PUPIL_RANGE = 1.35;
const LOOK_DISTANCE = 720;

type Pose = 'idle' | 'float' | 'pet' | 'hop' | (typeof POSES)[number];
type Motion = 'rest' | 'fall' | 'float' | 'pop' | 'drift';

function subscribeReducedMotion(callback: () => void) {
  const mediaQuery = window.matchMedia(reducedMotionQuery);
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(reducedMotionQuery).matches,
    () => false
  );
}

export function Mascot({ className }: { className?: string }) {
  const { t } = useTranslation();
  const reducedMotion = usePrefersReducedMotion();
  const arenaRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dragStartRef = useRef({ px: 0, py: 0, x: 0, y: 0 });
  const hideTipRef = useRef(0);
  const draggedRef = useRef(false);
  const userPlacedRef = useRef(false);
  const boundsRef = useRef<MascotBounds | null>(null);
  const pettingRef = useRef(false);
  const pointerNearRef = useRef(false);
  const [pose, setPose] = useState<Pose>('idle');
  const [petting, setPetting] = useState(false);
  const [lineIndex, setLineIndex] = useState(() => pickMascotLine(LINES.length, null));
  const [bubbleOn, setBubbleOn] = useState(true);
  const [arenaHeight, setArenaHeight] = useState(0);
  const [blinking, setBlinking] = useState(false);
  const [pupil, setPupil] = useState({ x: 0, y: 0 });
  const [placement, setPlacement] = useState<MascotPlacement>(REST_MASCOT_PLACEMENT);
  const [motion, setMotion] = useState<Motion>('rest');
  const [lifted, setLifted] = useState(false);
  const [bursting, setBursting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const placementRef = useRef(placement);
  const idleTimerRef = useRef(0);
  const landingTimerRef = useRef(0);
  const bubbleTimerRef = useRef(0);
  const bubbleRef = useRef<HTMLElement>(null);
  const [bubbleShift, setBubbleShift] = useState({ x: 0, y: 0 });
  placementRef.current = placement;

  useEffect(() => {
    if (reducedMotion || playing) {
      setPupil({ x: 0, y: 0 });
      setBlinking(false);
      return;
    }

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      const node = buttonRef.current;
      if (!node) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const dx = event.clientX - (rect.left + rect.width * 0.42);
        const dy = event.clientY - (rect.top + rect.height * 0.36);
        const distance = Math.hypot(dx, dy);
        if (distance > LOOK_DISTANCE) {
          pointerNearRef.current = false;
          return;
        }
        pointerNearRef.current = true;
        const scale = Math.min(PUPIL_RANGE, distance / 36) / (distance || 1);
        const next = { x: Number((dx * scale).toFixed(2)), y: Number((dy * scale).toFixed(2)) };
        setPupil((current) => (current.x === next.x && current.y === next.y ? current : next));
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, [reducedMotion, playing]);

  useEffect(() => {
    if (reducedMotion || playing) return;
    let wait = 0;
    let close = 0;
    const schedule = () => {
      wait = window.setTimeout(() => {
        setBlinking(true);
        close = window.setTimeout(() => {
          setBlinking(false);
          schedule();
        }, 130);
      }, 2800 + Math.random() * 2600);
    };
    schedule();
    return () => {
      window.clearTimeout(wait);
      window.clearTimeout(close);
    };
  }, [reducedMotion, playing]);

  useEffect(() => {
    if (reducedMotion || playing) return;
    let wait = 0;
    let back = 0;
    const schedule = () => {
      wait = window.setTimeout(() => {
        if (!pointerNearRef.current && !draggedRef.current) {
          const next = { x: Number(((Math.random() - 0.4) * 1.6).toFixed(2)), y: Number(((Math.random() - 0.5) * 1.1).toFixed(2)) };
          setPupil(next);
          back = window.setTimeout(() => {
            if (!pointerNearRef.current) setPupil({ x: 0, y: 0 });
            schedule();
          }, 900);
          return;
        }
        schedule();
      }, 3600 + Math.random() * 2800);
    };
    schedule();
    return () => {
      window.clearTimeout(wait);
      window.clearTimeout(back);
    };
  }, [reducedMotion, playing]);

  useEffect(() => () => {
    window.clearTimeout(hideTipRef.current);
    window.clearTimeout(idleTimerRef.current);
    window.clearTimeout(landingTimerRef.current);
    window.clearTimeout(bubbleTimerRef.current);
  }, []);

  const scheduleIdle = () => {
    window.clearTimeout(idleTimerRef.current);
    if (reducedMotion || playingRef.current) return;
    idleTimerRef.current = window.setTimeout(() => {
      if (pettingRef.current) return;
      setLifted(true);
      setPose('float');
      setMotion('float');
    }, MASCOT_IDLE_MS);
  };

  useEffect(() => {
    if (playing) {
      window.clearTimeout(idleTimerRef.current);
      return;
    }
    scheduleIdle();
    return () => window.clearTimeout(idleTimerRef.current);
  }, [reducedMotion, playing]);

  useEffect(() => {
    if (playing || motion === 'rest') return;
    const bounds = readBounds();
    if (reducedMotion) {
      const y = motion === 'float' ? -bounds.maxY + 108 : bounds.maxY;
      setPlacement((current) => {
        const next = resolveMascotDrag(current.x, y, bounds, false);
        placementRef.current = next;
        return next;
      });
      setLifted(false);
      setBursting(false);
      setMotion('rest');
      scheduleIdle();
      return;
    }

    let frame = 0;
    let landedTimer = 0;
    let last = performance.now();
    let velocity = 0;
    let stopped = false;
    const baseX = placementRef.current.x;
    const driftStartY = placementRef.current.y;
    const driftStarted = performance.now();
    const driftLength = driftDuration(readBounds().maxY - driftStartY);

    const finishFall = (floor: number) => {
      stopped = true;
      const landed = resolveMascotDrag(baseX, floor, readBounds(), false);
      const squashed = { ...landed, scaleX: 1.08, scaleY: 0.84, originX: '50%', originY: '100%' };
      placementRef.current = squashed;
      setPlacement(squashed);
      landedTimer = window.setTimeout(() => {
        setPlacement((current) => {
          const restored = { ...current, scaleX: 1, scaleY: 1, originX: '50%', originY: '72%' };
          placementRef.current = restored;
          return restored;
        });
        setMotion('rest');
        scheduleIdle();
      }, 160);
      landingTimerRef.current = landedTimer;
    };

    const tick = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.034, (now - last) / 1000);
      last = now;
      const limit = readBounds();
      const current = placementRef.current;
      if (motion === 'fall') {
        const next = stepFall(current.y, velocity, limit.maxY, dt);
        velocity = next.velocity;
        if (next.landed) {
          finishFall(limit.maxY);
          return;
        }
        const falling = { ...current, y: next.y, scaleX: 1, scaleY: 1, originX: '50%', originY: '72%' };
        placementRef.current = falling;
        setPlacement(falling);
      } else if (motion === 'float') {
        const next = stepFloat(current.y, -limit.maxY + 108, dt);
        const sway = Math.sin(now / 680) * 7;
        const x = Math.min(limit.maxX, Math.max(-limit.maxX, baseX + sway));
        const floating = { ...current, x, y: next.y, scaleX: 1, scaleY: 1, originX: '50%', originY: '72%' };
        placementRef.current = floating;
        setPlacement(floating);
        if (next.arrived) {
          stopped = true;
          setBursting(true);
          setMotion('pop');
          return;
        }
      } else if (motion === 'drift') {
        const elapsed = (now - driftStarted) / 1000;
        const amplitude = Math.min(54, Math.max(22, limit.maxX * 0.78));
        const next = stepDrift(driftStartY, limit.maxY, elapsed, driftLength, amplitude);
        const x = Math.min(limit.maxX, Math.max(-limit.maxX, baseX + next.x));
        if (next.done) {
          finishFall(limit.maxY);
          return;
        }
        const drifting = { ...current, x, y: next.y, scaleX: 1, scaleY: 1, originX: '50%', originY: '72%' };
        placementRef.current = drifting;
        setPlacement(drifting);
      } else if (motion === 'pop') {
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };

    if (motion === 'pop') {
      landedTimer = window.setTimeout(() => {
        setLifted(false);
        setBursting(false);
        setMotion('drift');
      }, 460);
      landingTimerRef.current = landedTimer;
      return () => window.clearTimeout(landedTimer);
    }

    frame = window.requestAnimationFrame(tick);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(landedTimer);
    };
  }, [motion, reducedMotion, playing]);

  const holdPose = (nextPose: Pose, hold = 3200) => {
    setPose(nextPose);
    window.clearTimeout(hideTipRef.current);
    hideTipRef.current = window.setTimeout(() => setPose('idle'), hold);
  };

  const readBounds = () => {
    const arena = arenaRef.current;
    const figure = buttonRef.current;
    if (!arena || !figure) return { maxX: 0, maxY: 0 };
    return {
      maxX: Math.max(0, (arena.clientWidth - figure.offsetWidth) / 2 - MASCOT_EDGE_INSET),
      maxY: Math.max(0, (arena.clientHeight - figure.offsetHeight) / 2 - MASCOT_EDGE_INSET),
    };
  };

  const armBubble = () => {
    window.clearTimeout(bubbleTimerRef.current);
    bubbleTimerRef.current = window.setTimeout(() => setBubbleOn(false), MASCOT_BUBBLE_MS);
  };

  const showTip = () => {
    const next = pickMascotLine(LINES.length, lineIndex);
    setLineIndex(next);
    setBubbleOn(true);
    holdPose(POSES[next % POSES.length]);
    armBubble();
  };

  useEffect(() => {
    armBubble();
    return () => window.clearTimeout(bubbleTimerRef.current);
  }, []);

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena) return;
    const syncArena = () => {
      setArenaHeight(arena.clientHeight);
      const figure = buttonRef.current;
      if (!figure || arena.clientWidth < 16 || arena.clientHeight < 16) return;
      if (motion !== 'rest' || pettingRef.current) return;
      const next = readBounds();
      const previous = boundsRef.current;
      boundsRef.current = next;
      const homeX = mascotHomeX(arena.clientWidth, figure.offsetWidth);
      setPlacement((current) => {
        const followed = previous ? followMascotBounds(current, previous, next) : current;
        const x = userPlacedRef.current ? followed.x : homeX;
        const y = previous ? followed.y : current.y;
        if (current.x === x && current.y === y) return current;
        const nextPlacement = { ...current, x, y };
        placementRef.current = nextPlacement;
        return nextPlacement;
      });
    };
    syncArena();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncArena);
    observer.observe(arena);
    return () => observer.disconnect();
  }, [playing, motion]);

  useLayoutEffect(() => {
    const arena = arenaRef.current;
    const bubble = bubbleRef.current;
    if (!bubbleOn || !arena || !bubble) return;
    const arenaRect = arena.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    if (arenaRect.width < 16 || bubbleRect.width < 8) return;
    const correction = resolveBubbleShift(
      { width: arenaRect.width, height: arenaRect.height },
      {
        left: bubbleRect.left - arenaRect.left,
        top: bubbleRect.top - arenaRect.top,
        width: bubbleRect.width,
        height: bubbleRect.height,
      },
    );
    if (correction.x === 0 && correction.y === 0) return;
    const scaleX = placement.scaleX || 1;
    const scaleY = placement.scaleY || 1;
    setBubbleShift((prev) => ({
      x: Math.round((prev.x + correction.x / scaleX) * 10) / 10,
      y: Math.round((prev.y + correction.y / scaleY) * 10) / 10,
    }));
  }, [bubbleOn, lineIndex, lifted, placement.x, placement.y, placement.scaleX, placement.scaleY, arenaHeight, playing]);

  const line = t(LINES[lineIndex]);
  const invite = LINES[lineIndex] === MASCOT_PLAY_LINE;
  const activePose = petting ? 'pet' : pose;

  const startGame = () => {
    playingRef.current = true;
    window.clearTimeout(idleTimerRef.current);
    window.clearTimeout(landingTimerRef.current);
    window.clearTimeout(hideTipRef.current);
    window.clearTimeout(bubbleTimerRef.current);
    setLifted(false);
    setBursting(false);
    setMotion('rest');
    setPlaying(true);
  };

  const stopGame = () => {
    playingRef.current = false;
    setPlaying(false);
    setBubbleOn(true);
    setMotion('rest');
    scheduleIdle();
    armBubble();
  };

  const cornerVisible = mascotCornerVisible(arenaHeight, placement.y, lifted, bubbleOn);
  const bubbleTransform = `translate(calc(${lifted ? '-42%' : '-50%'} + ${bubbleShift.x}px), calc(-100% - 0.35rem + ${bubbleShift.y}px))`;
  const bubbleTailLeft = `clamp(0.75rem, calc(50% - ${bubbleShift.x}px), calc(100% - 0.75rem))`;

  if (playing) {
    return (
      <div className={cn('relative h-full min-h-0 w-full', className)}>
        <MascotRace onExit={stopGame} />
      </div>
    );
  }

  return (
    <div className={cn('relative h-full min-h-0 w-full', className)}>
      <div ref={arenaRef} data-mascot-arena className="absolute inset-0 overflow-hidden">
        <MascotCorner visible={cornerVisible} />
        <button
        ref={buttonRef}
        type="button"
        onPointerDown={(event) => {
          draggedRef.current = false;
          if (event.button !== 0) return;
          pettingRef.current = true;
          window.clearTimeout(idleTimerRef.current);
          window.clearTimeout(landingTimerRef.current);
          armBubble();
          setLifted(false);
          setBursting(false);
          setMotion('rest');
          setPlacement((current) => {
            const restored = { ...current, scaleX: 1, scaleY: 1, originX: '50%', originY: '72%' };
            placementRef.current = restored;
            return restored;
          });
          dragStartRef.current = { px: event.clientX, py: event.clientY, x: placement.x, y: placement.y };
          setPetting(true);
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {
            // jsdom 没有指针捕获时，拖动仍由本元素的事件处理。
          }
        }}
        onPointerMove={(event) => {
          if (!pettingRef.current) return;
          const desiredX = dragStartRef.current.x + event.clientX - dragStartRef.current.px;
          const desiredY = dragStartRef.current.y + event.clientY - dragStartRef.current.py;
          const traveled = Math.hypot(desiredX - dragStartRef.current.x, desiredY - dragStartRef.current.y);
          if (traveled > 3 || Math.hypot(event.movementX, event.movementY) > 3) {
            draggedRef.current = true;
            userPlacedRef.current = true;
          }
          setPlacement(resolveMascotDrag(desiredX, desiredY, readBounds()));
        }}
        onPointerUp={() => {
          pettingRef.current = false;
          setPetting(false);
          const bounds = readBounds();
          const shouldDrop = draggedRef.current;
          setPlacement((current) => {
            const next = resolveMascotDrag(current.x, reducedMotion && shouldDrop ? bounds.maxY : current.y, bounds, false);
            placementRef.current = next;
            return next;
          });
          if (!shouldDrop) {
            scheduleIdle();
            return;
          }
          if (reducedMotion) scheduleIdle();
          else setMotion('fall');
        }}
        onPointerCancel={() => {
          pettingRef.current = false;
          setPetting(false);
          setPlacement((current) => {
            const next = resolveMascotDrag(current.x, current.y, readBounds(), false);
            placementRef.current = next;
            return next;
          });
          scheduleIdle();
        }}
        onClick={() => {
          if (draggedRef.current) {
            draggedRef.current = false;
            holdPose('pet', 1600);
            return;
          }
          showTip();
        }}
        onDoubleClick={() => {
          if (reducedMotion) return;
          holdPose('hop', 900);
        }}
        title={t('app.mascotLabel')}
        aria-label={t('app.mascotLabel')}
        data-motion={lifted ? 'float' : motion}
        data-pose={activePose}
        data-reduced-motion={reducedMotion ? 'true' : 'false'}
        data-x={placement.x}
        data-y={placement.y}
        data-squash-x={placement.scaleX}
        data-squash-y={placement.scaleY}
        className={cn(
          'mascot group absolute left-1/2 top-1/2 z-10 flex h-40 w-36 cursor-grab items-center justify-center rounded-3xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:cursor-grabbing',
          blinking && activePose !== 'wink' && activePose !== 'pet' && 'is-blinking'
        )}
        style={{
          transform: `translate(calc(-50% + ${placement.x}px), calc(-50% + ${placement.y}px)) scale(${placement.scaleX}, ${placement.scaleY})`,
          transformOrigin: `${placement.originX} ${placement.originY}`,
        }}
      >
        <svg viewBox="0 0 200 220" overflow="visible" className="mascot-figure relative h-[92%] w-[92%]" aria-hidden="true">
          <ellipse cx="102" cy="198" rx="40" ry="5" fill="var(--ox-ink)" opacity="0.12" />
          <g className="mascot-tail">
            <path d="M152 136c18 2 24-14 16-28" fill="none" stroke="var(--ox)" strokeWidth="4.2" strokeLinecap="round" />
            <path d="M166 106c6-8 14-7 16 2-6 2-11 5-16 3z" fill="var(--ox)" />
          </g>
          <path d="M56 136c1-22 22-38 48-40 32-2 58 14 62 36 3 18-6 40-26 48-22 9-54 8-72-2-12-7-13-24-12-42z" fill="var(--ox)" />
          <path d="M76 176c-1 8 8 14 16 10" fill="none" stroke="var(--ox-horn)" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          <path d="M116 178c2 8 12 8 14 0" fill="none" stroke="var(--ox-horn)" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
          <g className="mascot-ear mascot-ear-left">
            <ellipse cx="62" cy="80" rx="12" ry="16" transform="rotate(-30 62 80)" fill="var(--ox)" />
            <ellipse cx="64" cy="82" rx="5.5" ry="8" transform="rotate(-30 64 82)" fill="var(--ox-paper)" opacity="0.7" />
          </g>
          <g className="mascot-ear mascot-ear-right">
            <ellipse cx="134" cy="76" rx="12" ry="16" transform="rotate(24 134 76)" fill="var(--ox)" />
            <ellipse cx="132" cy="78" rx="5.5" ry="8" transform="rotate(24 132 78)" fill="var(--ox-paper)" opacity="0.65" />
          </g>
          <path d="M80 60c-6-16-2-26 5-27 3 7 5 16 3 24-1 2-5 3-8 3z" fill="var(--ox-horn)" />
          <path d="M114 56c5-16 16-20 21-12 2 5-1 14-7 19-4 3-10 2-13-2-1-1-1-3-1-5z" fill="var(--ox-horn)" />
          <circle cx="98" cy="92" r="44" fill="var(--ox)" />
          <ellipse cx="86" cy="76" rx="20" ry="12" fill="white" opacity="0.13" />
          <ellipse cx="90" cy="110" rx="19" ry="12.5" fill="var(--ox-paper)" />
          <path d="M80 114c1.3 1.4 3.6 1.4 5 0" fill="none" stroke="var(--ox-ink)" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
          <path d="M94 115c1.3 1.4 3.6 1.4 5 0" fill="none" stroke="var(--ox-ink)" strokeWidth="1.4" strokeLinecap="round" opacity="0.5" />
          <path d="M78 120c6 4.5 16 4.5 23 0" fill="none" stroke="var(--ox-horn)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4" />
          <g className="mascot-eyes">
            <g className="mascot-eye-left">
              <g className="mascot-pupil" transform={`translate(${pupil.x} ${pupil.y})`}>
                <ellipse cx="82" cy="86" rx="4.4" ry="5.4" fill="var(--ox-ink)" />
                <circle cx="83.3" cy="84.4" r="1.25" fill="white" />
              </g>
            </g>
            <g className="mascot-eye-right">
              <g className="mascot-pupil" transform={`translate(${pupil.x} ${pupil.y})`}>
                <ellipse cx="108" cy="84" rx="4.4" ry="5.4" fill="var(--ox-ink)" />
                <circle cx="109.3" cy="82.4" r="1.25" fill="white" />
              </g>
            </g>
          </g>
          {(lifted || bursting) && (
            <g className="mascot-hold">
              <path d="M128 126c22-8 34-40 18-72" fill="none" stroke="var(--ox)" strokeWidth="9" strokeLinecap="round" />
              <circle cx="144" cy="52" r="8" fill="var(--ox)" />
              <path d="M144 44c2-12 6-22 4-34" fill="none" stroke="var(--ox-horn)" strokeWidth="1.6" strokeLinecap="round" />
              {lifted && (
                <g className={cn('mascot-balloon', bursting && 'is-popping')}>
                  <ellipse cx="148" cy="-6" rx="16" ry="19" fill="var(--ox)" />
                  <ellipse cx="142" cy="-12" rx="4.2" ry="6" fill="white" opacity="0.38" />
                  <path d="M148 13v6" fill="none" stroke="var(--ox-horn)" strokeWidth="1.5" strokeLinecap="round" />
                </g>
              )}
              {bursting && (
                <g className="mascot-burst-svg" transform="translate(148 -6)">
                  <circle className="ring" r="11" fill="none" stroke="var(--ox)" strokeWidth="2" />
                  <circle className="shard s1" r="5" fill="var(--ox)" />
                  <circle className="shard s2" r="4.5" fill="var(--ox)" />
                  <circle className="shard s3" r="4" fill="var(--ox-paper)" />
                  <circle className="shard s4" r="3.5" fill="var(--ox)" />
                  <circle className="shard s5" r="3" fill="var(--ox-horn)" />
                  <circle className="shard s6" r="3.2" fill="var(--ox)" />
                  <circle className="shard s7" r="2.4" fill="var(--ox-paper)" />
                  <circle className="shard s8" r="2.6" fill="var(--ox)" />
                </g>
              )}
            </g>
          )}
        </svg>
        {bubbleOn && !invite && (
          <p
            key={lineIndex}
            ref={(node) => { bubbleRef.current = node; }}
            role="status"
            className={cn(
              'mascot-bubble pointer-events-none absolute top-[14%] z-10 w-max max-w-[12.5rem] rounded-2xl border border-border bg-card px-3 py-1.5 text-center text-[13px] leading-5 text-card-foreground shadow-tinted-sm',
              lifted ? 'left-[36%]' : 'left-1/2'
            )}
            style={{ transform: bubbleTransform }}
          >
            {line}
            <span className="absolute top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r border-b border-border bg-card" style={{ left: bubbleTailLeft }} />
          </p>
        )}
        </button>
        {bubbleOn && invite && (
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-40 w-36"
            style={{ transform: `translate(calc(-50% + ${placement.x}px), calc(-50% + ${placement.y}px))` }}
          >
            <div
              ref={(node) => { bubbleRef.current = node; }}
              onPointerEnter={armBubble}
              className={cn(
                'mascot-bubble pointer-events-auto absolute top-[14%] z-10 flex w-max max-w-[12.5rem] flex-col items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-center text-[13px] leading-5 text-card-foreground shadow-tinted-sm',
                lifted ? 'left-[36%]' : 'left-1/2'
              )}
              style={{ transform: bubbleTransform }}
            >
              <p role="status">{line}</p>
              <button
                type="button"
                onClick={startGame}
                className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity duration-150 hover:bg-primary/90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {t('app.mascotPlayYes')}
              </button>
              <span className="absolute top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-r border-b border-border bg-card" style={{ left: bubbleTailLeft }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
