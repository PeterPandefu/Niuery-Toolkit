import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { AppWindow, AudioLines, Check, CircleStop, Clock3, ExternalLink, FileImage, FolderOpen, Monitor, MonitorUp, Pause, Play, RefreshCw, Save, Video, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { GifEditor } from './GifEditor';
import { decodeGif } from './gif-worker';
import { createInitialRecorderState, recorderReducer } from './recorder-reducer';
import { useRecorder } from './useRecorder';
import {
  DEFAULT_RECORDING_SETTINGS,
  type CaptureMode,
  type CaptureRect,
  type CaptureTarget,
  type RecordingSettings,
} from './types';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function ScreenRecorder() {
  const log = useToolLogger('screen-recorder');
  const [state, dispatch] = useReducer(recorderReducer, undefined, createInitialRecorderState);
  const [view, setView] = useState<'recorder' | 'gif'>('recorder');
  const [mode, setMode] = useState<CaptureMode>('region');
  const [monitorId, setMonitorId] = useState('');
  const [windowId, setWindowId] = useState('');
  const [region, setRegion] = useState<CaptureRect>({ x: 0, y: 0, width: 1280, height: 720 });
  const [settings, setSettings] = useState<RecordingSettings>(DEFAULT_RECORDING_SETTINGS);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [previewSource, setPreviewSource] = useState<string | null>(null);
  const recorder = useRecorder({
    onStatus: (event) => {
      setElapsedMs(event.elapsedMs);
      if (event.status === 'paused') dispatch({ type: 'paused' });
      if (event.status === 'recording' && state.status === 'paused') dispatch({ type: 'resumed' });
      if (event.status === 'stopped' && event.artifact) dispatch({ type: 'stopped', artifact: event.artifact });
      if (event.error) dispatch({ type: 'error', message: event.error });
    },
  });
  const refreshSources = recorder.refreshSources;
  const loadPreview = recorder.loadPreview;

  useEffect(() => {
    void refreshSources().then((sources) => {
      if (!sources) return;
      const primary = sources.monitors.find((item) => item.primary) ?? sources.monitors[0];
      if (primary) {
        setMonitorId(primary.id);
        setRegion({ x: primary.x, y: primary.y, width: Math.min(1280, primary.width), height: Math.min(720, primary.height) });
      }
    });
  }, [refreshSources]);

  useEffect(() => {
    if (state.status !== 'recording') return;
    const started = Date.now() - elapsedMs;
    const timer = window.setInterval(() => setElapsedMs(Date.now() - started), 250);
    return () => window.clearInterval(timer);
  }, [elapsedMs, state.status]);

  useEffect(() => {
    if (state.status !== 'preview' || !state.artifact) {
      setPreviewSource(null);
      return;
    }
    let active = true;
    let source: string | null = null;
    void loadPreview().then((nextSource) => {
      if (!nextSource) return;
      if (!active) {
        URL.revokeObjectURL(nextSource);
        return;
      }
      source = nextSource;
      setPreviewSource(nextSource);
    });
    return () => {
      active = false;
      if (source) URL.revokeObjectURL(source);
    };
  }, [loadPreview, state.artifact, state.status]);

  const target = useMemo<CaptureTarget | null>(() => {
    if (mode === 'window') return windowId ? { mode, windowId: Number(windowId) } : null;
    if (!monitorId) return null;
    return mode === 'region' ? { mode, monitorId, rect: region } : { mode, monitorId };
  }, [mode, monitorId, region, windowId]);

  const startRecording = async () => {
    if (!isTauri) {
      log.warn('当前环境不支持录屏');
      toast.error('录屏仅可在 Windows 桌面版使用');
      return;
    }
    if (!target) {
      log.warn('未选择录制目标', { mode });
      toast.error(mode === 'window' ? '请选择要录制的窗口' : '请选择要录制的显示器');
      return;
    }
    dispatch({ type: 'countdown' });
    if (settings.countdownSec > 0) await new Promise((resolve) => window.setTimeout(resolve, settings.countdownSec * 1000));
    const session = await recorder.start(target, settings);
    if (session) {
      setElapsedMs(0);
      dispatch({ type: 'started', session });
      log.info('录制已开始', { mode, fps: settings.fps, quality: settings.quality });
    } else {
      log.error('录制启动失败', recorder.error);
      dispatch({ type: 'error', message: recorder.error ?? '无法开始录制' });
    }
  };

  const pauseOrResume = async () => {
    if (state.status === 'recording') {
      if (await recorder.pause()) dispatch({ type: 'paused' });
      return;
    }
    if (state.status === 'paused' && await recorder.resume()) dispatch({ type: 'resumed' });
  };

  const stopRecording = async () => {
    dispatch({ type: 'stopping' });
    const artifact = await recorder.stop();
    if (artifact) {
      dispatch({ type: 'stopped', artifact });
      log.info('录制已停止', {
        durationMs: artifact.durationMs,
        width: artifact.width,
        height: artifact.height,
        sizeBytes: artifact.sizeBytes,
      });
    } else {
      log.error('停止录制失败', recorder.error);
      dispatch({ type: 'error', message: recorder.error ?? '录制停止失败' });
    }
  };

  const cancelRecording = async () => {
    if (await recorder.cancel()) {
      log.info('录制已取消');
      dispatch({ type: 'cancelled' });
      setElapsedMs(0);
    }
  };

  const exportRecording = async (format: 'mp4' | 'gif') => {
    log.info('导出录制开始', { format });
    try {
      const result = await recorder.exportRecording(format, format === 'gif' ? { fps: 12, maxWidth: 800, loopCount: 0 } : {});
      if (result) {
        log.info('导出录制成功', { format, path: result.path, sizeBytes: result.sizeBytes });
        if (result.warning) {
          log.warn('导出录制完成但需要清理', { format, path: result.path, warning: result.warning });
          toast.warning(result.warning);
        } else {
          toast.success(`${format.toUpperCase()} 已保存到 ${result.path}`);
        }
      } else {
        log.info('导出录制已取消', { format });
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      log.error('导出录制失败', { format, error: message });
      toast.error(message);
    }
  };

  const revealRecordingInFolder = async () => {
    if (await recorder.revealInFolder()) {
      log.info('已定位录制缓存文件', { path: state.artifact?.path });
    } else {
      toast.error(recorder.error ?? '无法打开录制文件所在目录');
    }
  };

  const qualityLabel = (quality?: RecordingSettings['quality']) => ({
    high: '高质量',
    balanced: '均衡',
    small: '小文件',
  }[quality ?? 'balanced']);

  const openRecordingInGifEditor = async () => {
    const prepared = await recorder.prepareGifEditor();
    if (!prepared) return;
    if (prepared.warning) {
      log.warn('GIF 编辑器准备完成但需要清理', { path: prepared.path, warning: prepared.warning });
      toast.warning(prepared.warning);
    }
    try {
      const response = await fetch(convertFileSrc(prepared.path));
      if (!response.ok) throw new Error('无法读取临时 GIF');
      const decoded = decodeGif(await response.arrayBuffer());
      dispatch({ type: 'gifLoaded', ...decoded });
      setView('gif');
      log.info('录制已载入 GIF 编辑器', { frames: decoded.frames.length });
    } catch (reason) {
      log.warn('GIF 项目载入失败', reason);
      toast.error(reason instanceof Error ? reason.message : String(reason));
    }
  };

  if (view === 'gif') {
    return <GifEditor project={state.gif} dispatch={dispatch} onBack={() => setView('recorder')} />;
  }

  if (state.status === 'recording' || state.status === 'paused' || state.status === 'stopping') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-tinted">
          <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${state.status === 'recording' ? 'bg-red-500/15 text-red-500 animate-glow-pulse' : 'bg-amber-500/15 text-amber-500'}`}>
            <Video className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-heading text-xl font-bold">{state.status === 'paused' ? '录制已暂停' : state.status === 'stopping' ? '正在生成预览…' : '正在录制'}</h2>
          <p className="mt-2 font-mono text-3xl tabular-nums text-foreground">{formatDuration(elapsedMs)}</p>
          <p className="mt-2 text-sm text-muted-foreground">目标 {settings.fps} FPS · {recorder.status?.fps ? `实际 ${recorder.status.fps} FPS` : '正在测量实际帧率'} · 已丢弃 {recorder.status?.droppedFrames ?? 0} 帧</p>
          <div className="mt-7 flex justify-center gap-3">
            <Button variant="outline" onClick={() => void pauseOrResume()} disabled={state.status === 'stopping'}>
              {state.status === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{state.status === 'paused' ? '继续' : '暂停'}
            </Button>
            <Button variant="destructive" onClick={() => void stopRecording()} disabled={state.status === 'stopping'}><CircleStop className="h-4 w-4" />停止录制</Button>
            <Button variant="ghost" onClick={() => void cancelRecording()} disabled={state.status === 'stopping'}>取消</Button>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">录制过程中按 Esc 可停止录制并进入预览。</p>
        </div>
      </div>
    );
  }

  if (state.status === 'preview' && state.artifact) {
    return (
      <div className="flex h-full min-h-0 flex-col p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="font-heading text-lg font-semibold">录制完成</h2>
            <p className="text-sm text-muted-foreground">{formatDuration(state.artifact.durationMs)} · {state.artifact.width} × {state.artifact.height}{state.artifact.sizeBytes ? ` · ${formatBytes(state.artifact.sizeBytes)}` : ''}</p>
            <p className="mt-1 text-xs text-muted-foreground">目标 {state.artifact.requestedFps ?? '—'} FPS · 实际 {state.artifact.fps ?? '—'} FPS · {qualityLabel(state.artifact.quality)}{state.artifact.captureBackend ? ` · ${state.artifact.captureBackend === 'gdigrab' ? '高速原生采集' : '兼容采集'}` : ''}</p>
          </div>
          <Button variant="outline" onClick={() => dispatch({ type: 'cancelled' })}>新建录制</Button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-black/90 p-4">
          {previewSource ? (
            <video className="max-h-full max-w-full rounded" controls>
              <source src={previewSource} type="video/mp4" />
            </video>
          ) : (
            <p className="text-sm text-muted-foreground">正在加载视频预览…</p>
          )}
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="outline" onClick={() => void revealRecordingInFolder()}><FolderOpen className="h-4 w-4" />打开所在文件夹</Button>
          <Button onClick={() => void exportRecording('mp4')}><Save className="h-4 w-4" />导出 MP4</Button>
          <Button variant="outline" onClick={() => void exportRecording('gif')}><FileImageIcon />导出 GIF</Button>
          <Button variant="outline" onClick={() => void openRecordingInGifEditor()}><ExternalLink className="h-4 w-4" />编辑 GIF</Button>
        </div>
        {recorder.error && <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">{recorder.error}</p>}
        <p className="mt-3 break-all text-center font-mono text-xs text-muted-foreground">缓存文件：{state.artifact.path}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/10 text-red-500"><Video className="h-5 w-5" /></span><h2 className="font-heading text-xl font-bold">屏幕录制</h2></div>
            <p className="mt-2 text-sm text-muted-foreground">区域、窗口或整个显示器录制；停止后可导出 MP4 或制作 GIF。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void recorder.refreshSources()}><RefreshCw className="h-4 w-4" />刷新来源</Button>
            <Button variant="outline" onClick={() => setView('gif')}><FileImageIcon />GIF 编辑器</Button>
          </div>
        </div>

        {!isTauri && <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">录制依赖 Windows 桌面版。你仍可使用右上角的 GIF 编辑器。</div>}
        {(state.error || recorder.error) && <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{state.error ?? recorder.error}</div>}

        <div className="grid gap-5 lg:grid-cols-[1.25fr_.75fr]">
          <section className="rounded-xl border border-border bg-card p-5 shadow-tinted-sm">
            <h3 className="text-sm font-semibold">1. 选择录制内容</h3>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <ModeCard active={mode === 'region'} icon={<MonitorUp className="h-5 w-5" />} title="框选区域" description="录制显示器中的指定区域" onClick={() => setMode('region')} />
              <ModeCard active={mode === 'window'} icon={<AppWindow className="h-5 w-5" />} title="选择窗口" description="只录制指定应用窗口" onClick={() => setMode('window')} />
              <ModeCard active={mode === 'monitor'} icon={<Monitor className="h-5 w-5" />} title="整个显示器" description="录制一块完整屏幕" onClick={() => setMode('monitor')} />
            </div>

            {mode === 'window' ? (
              <div className="mt-5">
                <Label htmlFor="recording-window">窗口</Label>
                <Select id="recording-window" value={windowId} onChange={(event) => setWindowId(event.target.value)} options={[{ value: '', label: recorder.windows.length ? '请选择窗口' : '未找到可录制窗口' }, ...recorder.windows.map((item) => ({ value: String(item.id), label: `${item.appName} · ${item.title}` }))]} />
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <div>
                  <Label htmlFor="recording-monitor">显示器</Label>
                  <Select id="recording-monitor" value={monitorId} onChange={(event) => {
                    const nextId = event.target.value;
                    setMonitorId(nextId);
                    const next = recorder.monitors.find((item) => item.id === nextId);
                    if (next) setRegion({ x: next.x, y: next.y, width: Math.min(1280, next.width), height: Math.min(720, next.height) });
                  }} options={recorder.monitors.map((item) => ({ value: item.id, label: `${item.name} · ${item.width} × ${item.height}${item.primary ? '（主显示器）' : ''}` }))} />
                </div>
                {mode === 'region' && <RegionEditor region={region} monitor={recorder.monitors.find((item) => item.id === monitorId)} onChange={setRegion} />}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-tinted-sm">
            <h3 className="text-sm font-semibold">2. 录制设置</h3>
            <div className="mt-4 space-y-4">
              <SettingSelect label="帧率" value={String(settings.fps)} onChange={(value) => setSettings((current) => ({ ...current, fps: Number(value) as RecordingSettings['fps'] }))} options={[{ value: '15', label: '15 FPS · 文件更小' }, { value: '30', label: '30 FPS · 推荐' }, { value: '60', label: '60 FPS · 更流畅' }]} />
              <SettingSelect label="视频质量" value={settings.quality} onChange={(value) => setSettings((current) => ({ ...current, quality: value as RecordingSettings['quality'] }))} options={[{ value: 'high', label: '高 · CRF 18' }, { value: 'balanced', label: '均衡 · CRF 22' }, { value: 'small', label: '小文件 · CRF 28' }]} />
              <SettingSelect label="倒计时" value={String(settings.countdownSec)} onChange={(value) => setSettings((current) => ({ ...current, countdownSec: Number(value) as RecordingSettings['countdownSec'] }))} options={[{ value: '0', label: '立即开始' }, { value: '3', label: '3 秒 · 推荐' }, { value: '5', label: '5 秒' }]} />
              <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm"><span className="flex items-center gap-2"><MonitorUp className="h-4 w-4 text-muted-foreground" />光标高亮</span><input type="checkbox" checked={settings.cursorHighlight} onChange={(event) => setSettings((current) => ({ ...current, cursorHighlight: event.target.checked }))} /></label>
              <div className="rounded-lg border border-border p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium"><AudioLines className="h-4 w-4" />音频</div>
                <label className="flex items-center justify-between py-1.5 text-sm"><span className="flex items-center gap-2"><Volume2 className="h-4 w-4 text-muted-foreground" />麦克风</span><input type="checkbox" checked={settings.audio.microphone} onChange={(event) => setSettings((current) => ({ ...current, audio: { ...current.audio, microphone: event.target.checked, microphoneId: event.target.checked ? recorder.audioSources.find((item) => item.kind === 'microphone')?.id : undefined } }))} /></label>
                <label className="flex items-center justify-between py-1.5 text-sm"><span className="flex items-center gap-2"><VolumeX className="h-4 w-4 text-muted-foreground" />系统声音</span><input type="checkbox" checked={settings.audio.system} onChange={(event) => setSettings((current) => ({ ...current, audio: { ...current.audio, system: event.target.checked, systemId: event.target.checked ? recorder.audioSources.find((item) => item.kind === 'system')?.id : undefined } }))} /></label>
              </div>
            </div>
          </section>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
          <div className="flex items-center gap-3"><Clock3 className="h-5 w-5 text-primary" /><p className="text-sm text-muted-foreground">录制时主窗口会自动隐藏，按 Esc 可停止并直接查看预览。</p></div>
          <Button size="lg" onClick={() => void startRecording()} disabled={recorder.loading || !isTauri}><CircleStop className="h-4 w-4" />开始录制</Button>
        </div>
      </div>
    </div>
  );
}

function ModeCard({ active, icon, title, description, onClick }: { active: boolean; icon: ReactNode; title: string; description: string; onClick: () => void }) {
  return <button onClick={onClick} className={`relative rounded-lg border p-3 text-left transition ${active ? 'border-primary bg-primary/10 ring-2 ring-primary/15' : 'border-border hover:border-primary/40 hover:bg-accent/40'}`}><span className={active ? 'text-primary' : 'text-muted-foreground'}>{icon}</span><p className="mt-2 text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-muted-foreground">{description}</p>{active && <Check className="absolute right-2 top-2 h-4 w-4 text-primary" />}</button>;
}

function RegionEditor({ region, monitor, onChange }: { region: CaptureRect; monitor?: { x: number; y: number; width: number; height: number }; onChange: (value: CaptureRect) => void }) {
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const clamp = (next: CaptureRect) => {
    if (!monitor) return onChange(next);
    const width = Math.max(16, Math.min(next.width, monitor.width));
    const height = Math.max(16, Math.min(next.height, monitor.height));
    onChange({ x: Math.max(monitor.x, Math.min(next.x, monitor.x + monitor.width - width)), y: Math.max(monitor.y, Math.min(next.y, monitor.y + monitor.height - height)), width, height });
  };
  const field = (key: keyof CaptureRect, label: string) => <div><Label className="text-[11px]" htmlFor={`region-${key}`}>{label}</Label><Input id={`region-${key}`} type="number" value={region[key]} onChange={(event) => clamp({ ...region, [key]: Number(event.target.value) })} /></div>;
  const pointFor = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * (monitor?.width ?? 1) + (monitor?.x ?? 0);
    const y = ((event.clientY - bounds.top) / bounds.height) * (monitor?.height ?? 1) + (monitor?.y ?? 0);
    return { x: Math.round(x), y: Math.round(y) };
  };
  const selectByDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const end = pointFor(event);
    const start = dragStart.current;
    clamp({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.max(16, Math.abs(end.x - start.x)), height: Math.max(16, Math.abs(end.y - start.y)) });
  };
  const offsetX = monitor ? ((region.x - monitor.x) / monitor.width) * 100 : 0;
  const offsetY = monitor ? ((region.y - monitor.y) / monitor.height) * 100 : 0;
  const width = monitor ? (region.width / monitor.width) * 100 : 100;
  const height = monitor ? (region.height / monitor.height) * 100 : 100;
  return <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">框选区域</p><span className="text-xs text-muted-foreground">拖拽框选或用方向键微调</span></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{field('x', 'X')}{field('y', 'Y')}{field('width', '宽度')}{field('height', '高度')}</div>{monitor && <div role="application" tabIndex={0} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); dragStart.current = pointFor(event); }} onPointerMove={selectByDrag} onPointerUp={(event) => { selectByDrag(event); dragStart.current = null; }} onKeyDown={(event) => { const step = event.shiftKey ? 10 : 1; if (event.key === 'ArrowLeft') { event.preventDefault(); clamp({ ...region, x: region.x - step }); } if (event.key === 'ArrowRight') { event.preventDefault(); clamp({ ...region, x: region.x + step }); } if (event.key === 'ArrowUp') { event.preventDefault(); clamp({ ...region, y: region.y - step }); } if (event.key === 'ArrowDown') { event.preventDefault(); clamp({ ...region, y: region.y + step }); } }} className="relative mt-3 h-28 cursor-crosshair overflow-hidden rounded-md border border-border bg-gradient-to-br from-slate-500/30 via-slate-700/20 to-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-primary/60" aria-label="显示器区域选择器"><span className="absolute left-2 top-2 text-[10px] text-foreground/75">{monitor.width} × {monitor.height}</span><div className="absolute border-2 border-primary bg-primary/15 shadow-[0_0_0_999px_rgba(0,0,0,.18)]" style={{ left: `${offsetX}%`, top: `${offsetY}%`, width: `${width}%`, height: `${height}%` }} /></div>}</div>;
}

function SettingSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <div><Label>{label}</Label><Select value={value} onChange={(event) => onChange(event.target.value)} options={options} /></div>;
}

function formatDuration(value: number) {
  const totalSeconds = Math.floor(value / 1000);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function FileImageIcon() {
  return <FileImage className="h-4 w-4" />;
}
