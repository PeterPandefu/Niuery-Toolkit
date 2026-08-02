import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Activity, Cpu, HardDrive, MemoryStick, Pause, Play, RefreshCw, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface SystemStats {
  cpu_usage: number;
  cpu_count: number;
  memory_used_bytes: number;
  memory_total_bytes: number;
  network_received_bytes_per_sec: number;
  network_transmitted_bytes_per_sec: number;
  uptime_seconds: number;
  host_name: string | null;
}

interface Sample extends SystemStats {
  at: number;
}

const EMPTY_STATS: SystemStats = {
  cpu_usage: 0,
  cpu_count: 0,
  memory_used_bytes: 0,
  memory_total_bytes: 0,
  network_received_bytes_per_sec: 0,
  network_transmitted_bytes_per_sec: 0,
  uptime_seconds: 0,
  host_name: null,
};

function formatBytes(bytes: number, digits = 1) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : digits)} ${units[index]}`;
}

function formatDuration(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function Sparkline({ samples, color, valueKey }: { samples: Sample[]; color: string; valueKey: keyof Sample }) {
  const values = samples.map((sample) => Number(sample[valueKey]) || 0);
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => `${(index / Math.max(values.length - 1, 1)) * 100},${100 - (value / max) * 88 - 6}`)
    .join(' ');

  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-16 w-full overflow-visible">
      <defs>
        <linearGradient id={`fill-${valueKey}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,100 ${points} 100,100`} fill={`url(#fill-${valueKey})`} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Metric({ icon: Icon, label, value, detail, tone = 'primary' }: { icon: typeof Cpu; label: string; value: string; detail: string; tone?: 'primary' | 'blue' | 'green' }) {
  const toneClass = {
    primary: 'bg-primary/10 text-primary',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  }[tone];

  return (
    <section className="panel-raised min-w-0 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className={cn('flex h-7 w-7 items-center justify-center rounded-md', toneClass)}><Icon className="h-4 w-4" /></span>
          {label}
        </div>
        <Activity className="h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <span className="font-heading text-2xl font-semibold tracking-tight text-foreground">{value}</span>
        <span className="pb-0.5 text-right text-[11px] text-muted-foreground">{detail}</span>
      </div>
    </section>
  );
}

export default function SystemMonitor() {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const [stats, setStats] = useState<SystemStats>(EMPTY_STATS);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [running, setRunning] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sample = useCallback(async () => {
    if (!isTauri) {
      setLoading(false);
      setError('系统资源采集需要在 Tauri 桌面端运行');
      return;
    }
    try {
      const next = await invoke<SystemStats>('get_system_stats');
      setStats(next);
      setSamples((previous) => [...previous, { ...next, at: Date.now() }].slice(-36));
      setError(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [isTauri]);

  useEffect(() => {
    void sample();
    if (!running) return;
    const timer = window.setInterval(() => void sample(), 1000);
    return () => window.clearInterval(timer);
  }, [running, sample]);

  const memoryPercent = stats.memory_total_bytes > 0 ? (stats.memory_used_bytes / stats.memory_total_bytes) * 100 : 0;
  const networkTotal = stats.network_received_bytes_per_sec + stats.network_transmitted_bytes_per_sec;
  const latest = samples[samples.length - 1];
  const lastUpdated = latest ? new Date(latest.at).toLocaleTimeString() : '等待数据';
  const chartSamples = useMemo(() => samples.length > 1 ? samples : [{ ...stats, at: Date.now() }], [samples, stats]);

  return (
    <div className="app-ambient h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-6 pb-10 pt-6 sm:px-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-5">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
              <Activity className="h-3.5 w-3.5" /> Live telemetry
            </div>
            <h2 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-foreground">系统监控</h2>
            <p className="mt-1 text-sm text-muted-foreground">实时查看当前设备的 CPU、内存与网络活动。</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium', running ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-border bg-muted text-muted-foreground')}>
              <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'bg-emerald-500 animate-glow-pulse' : 'bg-muted-foreground/50')} />
              {running ? '实时采集中' : '已暂停'}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void sample()} title="立即刷新" aria-label="立即刷新"><RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /></Button>
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setRunning((value) => !value)}>
              {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {running ? '暂停' : '继续'}
            </Button>
          </div>
        </header>

        {error && <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{error}</div>}

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <Metric icon={Cpu} label="CPU 使用率" value={`${stats.cpu_usage.toFixed(1)}%`} detail={`${stats.cpu_count || '—'} 个逻辑核心`} />
          <Metric icon={MemoryStick} label="内存占用" value={`${memoryPercent.toFixed(1)}%`} detail={`${formatBytes(stats.memory_used_bytes)} / ${formatBytes(stats.memory_total_bytes)}`} tone="blue" />
          <Metric icon={Wifi} label="网络吞吐" value={formatBytes(networkTotal) + '/s'} detail={`↓ ${formatBytes(stats.network_received_bytes_per_sec)} · ↑ ${formatBytes(stats.network_transmitted_bytes_per_sec)}`} tone="green" />
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <section className="panel-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-sm font-semibold text-foreground">CPU 活动</h3><p className="mt-1 text-xs text-muted-foreground">最近 {Math.max(samples.length, 1)} 秒</p></div>
              <span className="font-mono text-xs text-muted-foreground">{lastUpdated}</span>
            </div>
            <div className="mt-4 rounded-md bg-muted/35 px-2 py-2"><Sparkline samples={chartSamples} color="hsl(var(--primary))" valueKey="cpu_usage" /></div>
            <div className="mt-3 flex justify-between text-[10px] text-muted-foreground"><span>低负载</span><span>峰值 {Math.max(...chartSamples.map((item) => item.cpu_usage), 0).toFixed(1)}%</span></div>
          </section>

          <section className="panel-raised p-4">
            <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-foreground">内存与网络</h3><p className="mt-1 text-xs text-muted-foreground">当前资源快照</p></div><HardDrive className="h-4 w-4 text-muted-foreground/50" /></div>
            <div className="mt-5 space-y-4">
              <div><div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground">内存</span><span className="font-mono text-foreground">{memoryPercent.toFixed(1)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-blue-500 transition-[width] duration-500" style={{ width: `${Math.min(memoryPercent, 100)}%` }} /></div></div>
              <div><div className="mb-1.5 flex justify-between text-xs"><span className="text-muted-foreground">网络</span><span className="font-mono text-foreground">{formatBytes(networkTotal)}/s</span></div><div className="flex h-8 items-end gap-1">{chartSamples.slice(-24).map((item, index) => <span key={`${item.at}-${index}`} className="min-w-0 flex-1 rounded-sm bg-emerald-500/60 transition-all" style={{ height: `${Math.max(10, Math.min(100, (item.network_received_bytes_per_sec + item.network_transmitted_bytes_per_sec) / Math.max(...chartSamples.map((value) => value.network_received_bytes_per_sec + value.network_transmitted_bytes_per_sec), 1) * 100))}%` }} />)}</div></div>
            </div>
          </section>
        </div>

        <footer className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground"><span>设备：{stats.host_name || (isTauri ? '本机' : '浏览器预览')}</span><span>运行时间：{formatDuration(stats.uptime_seconds)}</span><span>采样间隔：1 秒</span></footer>
      </div>
    </div>
  );
}
