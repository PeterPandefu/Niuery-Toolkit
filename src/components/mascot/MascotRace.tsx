import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RACE_PLAYER_BOTTOM,
  RACE_PLAYER_H,
  RACE_PLAYER_W,
  createRace,
  raceCheer,
  raceScore,
  stepRace,
  type RaceInput,
  type RaceState,
} from '@/lib/mascot-race';
import { cn } from '@/lib/utils';

const CHEER = ['app.mascotRaceCheer0', 'app.mascotRaceCheer1', 'app.mascotRaceCheer2', 'app.mascotRaceCheer3'] as const;

function Racer({ down }: { down: boolean }) {
  return (
    <svg viewBox="0 0 48 40" className={cn('h-full w-full', down && 'opacity-60')} aria-hidden="true">
      <ellipse cx="24" cy="37" rx="11" ry="2" fill="var(--ox-ink)" opacity="0.16" />
      <circle cx="15" cy="33.5" r="2.1" fill="var(--ox-ink)" />
      <circle cx="33" cy="33.5" r="2.1" fill="var(--ox-ink)" />
      <path d="M11 31h26" fill="none" stroke="var(--ox-horn)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 28c1-7 7-12 12-12s11 5 12 12c0 3-3 5-12 5s-12-2-12-5z" fill="var(--ox)" />
      <circle cx="24" cy="15" r="8.2" fill="var(--ox)" />
      <ellipse cx="18.5" cy="8.5" rx="2.6" ry="3.6" transform="rotate(-30 18.5 8.5)" fill="var(--ox)" />
      <ellipse cx="29.5" cy="8.5" rx="2.6" ry="3.6" transform="rotate(30 29.5 8.5)" fill="var(--ox)" />
      <path d="M17 11c-1-5 1.5-8 3.2-7" fill="none" stroke="var(--ox-horn)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M31 11c1-5-1.5-8-3.2-7" fill="none" stroke="var(--ox-horn)" strokeWidth="1.4" strokeLinecap="round" />
      <ellipse cx="24" cy="17.2" rx="3.6" ry="2.1" fill="var(--ox-paper)" />
      <circle cx="21.4" cy="14.6" r="1" fill="var(--ox-ink)" />
      <circle cx="26.6" cy="14.6" r="1" fill="var(--ox-ink)" />
    </svg>
  );
}

export function MascotRace({ onExit }: { onExit: () => void }) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement>(null);
  const onExitRef = useRef(onExit);
  const inputRef = useRef<RaceInput>({ pointerX: null, left: false, right: false });
  const retryRef = useRef<HTMLButtonElement>(null);
  const [runId, setRunId] = useState(0);
  const [state, setState] = useState<RaceState | null>(null);
  const [hintOn, setHintOn] = useState(true);
  const [spoken, setSpoken] = useState(0);
  const hintRef = useRef(true);
  onExitRef.current = onExit;

  const hideHint = () => {
    if (!hintRef.current) return;
    hintRef.current = false;
    setHintOn(false);
  };

  useEffect(() => {
    hintRef.current = true;
    setHintOn(true);
    setSpoken(0);
    inputRef.current = { pointerX: null, left: false, right: false };
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    let stopped = false;
    let ready = false;
    let current = createRace(track.clientWidth || 220);
    let last = performance.now();

    const tick = (now: number) => {
      if (stopped) return;
      const dt = Math.min(0.034, (now - last) / 1000);
      last = now;
      const width = track.clientWidth;
      const height = track.clientHeight;
      if (!ready) {
        if (width < 48 || height < 64) {
          frame = window.requestAnimationFrame(tick);
          return;
        }
        current = createRace(width);
        ready = true;
        setState(current);
      }
      if (current.alive && width >= 48 && height >= 64) {
        const next = stepRace(current, dt, inputRef.current, width, height);
        if (next !== current) {
          current = next;
          setState(next);
        }
        if (!next.alive) return;
      }
      frame = window.requestAnimationFrame(tick);
    };

    track.focus();
    frame = window.requestAnimationFrame(tick);
    return () => {
      stopped = true;
      window.cancelAnimationFrame(frame);
    };
  }, [runId]);

  useEffect(() => {
    if (state && !state.alive) retryRef.current?.focus();
  }, [state]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const region = trackRef.current;
      if (!region || (event.target !== region && !region.contains(event.target as Node))) return;
      const down = event.type === 'keydown';
      if (event.key === 'Escape' && down) {
        event.preventDefault();
        onExitRef.current();
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        if (down) event.preventDefault();
        inputRef.current.left = down;
        if (down) hideHint();
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        if (down) event.preventDefault();
        inputRef.current.right = down;
        if (down) hideHint();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  const score = state ? raceScore(state) : 0;
  const dead = Boolean(state && !state.alive);

  useEffect(() => {
    if (!state?.alive || score < spoken + 8) return;
    setSpoken(score);
  }, [score, spoken, state]);
  const cheer = t(CHEER[raceCheer(score)]);
  const point = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    inputRef.current.pointerX = event.clientX - rect.left;
    hideHint();
  };

  return (
    <div
      className="mascot flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-tinted-sm"
      onPointerMove={point}
      onPointerDown={point}
      onPointerLeave={() => {
        inputRef.current.pointerX = null;
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="font-heading text-lg font-semibold tabular-nums leading-none text-foreground">{t('app.mascotRaceScore', { score })}</p>
          <p className={cn('mt-1 text-xs leading-4 text-foreground/75', !hintOn && 'invisible')} aria-hidden={!hintOn}>{t('app.mascotRaceHint')}</p>
          <p className="sr-only" aria-live="polite">{state?.alive ? t('app.mascotRaceScore', { score: spoken }) : ''}</p>
        </div>
        <button
          type="button"
          onClick={() => onExitRef.current()}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-3 text-sm font-medium text-foreground transition-opacity duration-150 hover:bg-accent active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('app.mascotRaceExit')}
        </button>
      </div>
      <div
        ref={trackRef}
        role="region"
        aria-label={t('app.mascotRaceLabel')}
        aria-keyshortcuts="ArrowLeft ArrowRight"
        tabIndex={0}
        className="relative min-h-0 flex-1 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onBlur={() => {
          inputRef.current.left = false;
          inputRef.current.right = false;
        }}
      >
        <div className="pointer-events-none absolute inset-y-2 left-2 w-px bg-border" />
        <div className="pointer-events-none absolute inset-y-2 right-2 w-px bg-border" />
        <div
          className="pointer-events-none absolute inset-y-0 left-[22%] w-px"
          style={{
            backgroundImage: 'linear-gradient(to bottom, hsl(var(--foreground) / 0.28) 5px, transparent 5px)',
            backgroundSize: '1px 22px',
            backgroundPositionY: state ? state.distance % 22 : 0,
          }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-[22%] w-px"
          style={{
            backgroundImage: 'linear-gradient(to bottom, hsl(var(--foreground) / 0.28) 5px, transparent 5px)',
            backgroundSize: '1px 22px',
            backgroundPositionY: state ? (state.distance * 0.65) % 22 : 0,
          }}
        />
        {state?.obstacles.map((obstacle) => (
          <div
            key={obstacle.id}
            aria-hidden="true"
            className={cn(
              'absolute border border-foreground/20',
              obstacle.kind === 'rail' ? 'rounded-sm bg-foreground' : 'rounded-md bg-primary'
            )}
            style={{ left: obstacle.x, top: obstacle.y, width: obstacle.w, height: obstacle.h }}
          >
            <span
              className={cn(
                'absolute',
                obstacle.kind === 'rail'
                  ? 'inset-x-1 top-0.5 h-0.5 rounded-full bg-background/55'
                  : 'inset-x-1 top-1/2 h-px -translate-y-1/2 bg-primary-foreground/45'
              )}
            />
          </div>
        ))}
        <div
          className={cn('absolute', state ? '' : 'left-1/2 -translate-x-1/2')}
          style={state ? {
            left: state.playerX - RACE_PLAYER_W / 2,
            bottom: RACE_PLAYER_BOTTOM,
            width: RACE_PLAYER_W,
            height: RACE_PLAYER_H,
          } : { bottom: RACE_PLAYER_BOTTOM, width: RACE_PLAYER_W, height: RACE_PLAYER_H }}
        >
          <Racer down={dead} />
        </div>
        {dead && (
          <div className="absolute inset-x-2 bottom-2 top-2 flex items-end">
            <div role="status" className="w-full rounded-xl border border-border bg-card p-3 text-card-foreground shadow-tinted-sm">
              <p className="text-sm text-foreground">{t('app.mascotRaceHit')}</p>
              <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-foreground">{t('app.mascotRaceScore', { score })}</p>
              <p className="mt-2 text-sm leading-5 text-foreground">{cheer}</p>
              <button
                ref={retryRef}
                type="button"
                onClick={() => setRunId((id) => id + 1)}
                className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity duration-150 hover:bg-primary/90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                {t('app.mascotRaceRetry')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
