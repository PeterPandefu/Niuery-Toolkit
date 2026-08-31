import { useEffect, useReducer, useRef, useState } from 'react';
import type { CaptureRect, CaptureTarget, RecordingSettings } from './types';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { AudioLines, CircleStop, Clock3, ExternalLink, FileImage, FolderOpen, MonitorUp, Pause, Play, RefreshCw, Save, Video, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { GifEditor } from './GifEditor';
import { decodeGif } from './gif-worker';
import { createInitialRecorderState, recorderReducer } from './recorder-reducer';
import { useRecorder } from './useRecorder';
import { DEFAULT_RECORDING_SETTINGS } from './types';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export default function ScreenRecorder() {
  const log = useToolLogger('screen-recorder');
  const [state, dispatch] = useReducer(recorderReducer, undefined, createInitialRecorderState);
  const [view, setView] = useState<'recorder' | 'gif'>('recorder');
  const [monitorId, setMonitorId] = useState('');
  const [region, setRegion] = useState<CaptureRect | null>(null);
  const [minimizeBeforeCapture, setMinimizeBeforeCapture] = useState(true);
  const [settings, setSettings] = useState<RecordingSettings>(DEFAULT_RECORDING_SETTINGS);
  const [selectingRegion, setSelectingRegion] = useState(false);
  const [startingRecording, setStartingRecording] = useState(false);
  const startingRecordingRef = useRef(false);
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
    const nextSource = loadPreview();
    if (!nextSource) return;
    setPreviewSource(nextSource);
  }, [loadPreview, state.artifact, state.status]);

  const selectRecordingRegion = async () => {
    if (!isTauri) {
      log.warn('当前环境不支持录屏');
      toast.error('录屏仅可在 Windows 桌面版使用');
      return;
    }
    let selectedMonitorId = monitorId;
    if (!selectedMonitorId) {
      const sources = await refreshSources();
      const primary = sources?.monitors.find((item) => item.primary) ?? sources?.monitors[0];
      if (primary) {
        selectedMonitorId = primary.id;
        setMonitorId(primary.id);
      }
    }
    if (!selectedMonitorId) {
      log.warn('未找到可录制显示器');
      toast.error('未找到可录制显示器');
      return;
    }
    setSelectingRegion(true);
    try {
      await invoke('start_recording_region_selection', { minimizeBeforeCapture });
    } catch (error) {
      setSelectingRegion(false);
      log.error('打开录制区域框选失败', error);
      toast.error(`打开录制区域框选失败：${error}`);
    }
  };

  const startRecordingForRegion = async () => {
    if (startingRecordingRef.current || recorder.loading || state.status === 'recording' || state.status === 'paused' || state.status === 'stopping') return;
    if (!region) {
      toast.error('请先框选录制区域');
      return;
    }
    startingRecordingRef.current = true;
    setStartingRecording(true);
    const target: CaptureTarget = { mode: 'region', monitorId, rect: region };
    try {
      dispatch({ type: 'countdown' });
      if (settings.countdownSec > 0) await new Promise((resolve) => window.setTimeout(resolve, settings.countdownSec * 1000));
      const session = await recorder.start(target, settings);
      if (session) {
        setElapsedMs(0);
        dispatch({ type: 'started', session });
        log.info('录制已开始', { mode: 'region', fps: settings.fps, quality: settings.quality });
      } else {
        log.error('录制启动失败', recorder.error);
        dispatch({ type: 'error', message: recorder.error ?? '无法开始录制' });
      }
    } finally {
      startingRecordingRef.current = false;
      setStartingRecording(false);
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

  const startRecording = async () => {
    await startRecordingForRegion();
  };

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listen<{ x: number; y: number; width: number; height: number }>('recording-region-selected', (event) => {
      if (disposed) return;
      setSelectingRegion(false);
      // 后端通常会在关闭框选窗口时恢复主窗口；这里再做一次幂等恢复，
      // 覆盖确认事件与窗口隐藏之间的竞态，确保用户能立即点击“开始录制”。
      void invoke('restore_main_window_after_recording_region').catch(() => {});
      const monitor = recorder.monitors.find((item) => item.id === monitorId)
        ?? recorder.monitors.find((item) => item.primary)
        ?? recorder.monitors[0];
      if (!monitor) return;
      setRegion({
        x: Math.round(event.payload.x + monitor.x),
        y: Math.round(event.payload.y + monitor.y),
        width: Math.round(event.payload.width),
        height: Math.round(event.payload.height),
      });
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanup = unlisten;
    });
    let cancelCleanup: (() => void) | undefined;
    void listen('recording-region-cancelled', () => {
      if (!disposed) {
        setSelectingRegion(false);
        void invoke('restore_main_window_after_recording_region').catch(() => {});
      }
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cancelCleanup = unlisten;
    });
    return () => { disposed = true; cleanup?.(); cancelCleanup?.(); };
  }, [monitorId, recorder.monitors]);

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
            <p className="mt-2 text-sm text-muted-foreground">在屏幕上拖拽框选需要录制的区域；停止后可导出 MP4 或制作 GIF。</p>
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
            <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium"><MonitorUp className="h-5 w-5 text-primary" />框选录制区域</div>
                <Button variant="outline" onClick={() => void selectRecordingRegion()} disabled={recorder.loading || !isTauri || selectingRegion}>框选</Button>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">点击“框选”后，在屏幕上按住鼠标左键拖出区域，点击对勾确认；Esc 可取消。</p>
              <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={minimizeBeforeCapture} onChange={(event) => setMinimizeBeforeCapture(event.target.checked)} /><span>框选前最小化主窗口</span></label>
            </div>
            <div className="mt-3 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">已框选区域参数</p>
              {region ? <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{(['x', 'y', 'width', 'height'] as const).map((key) => <div key={key}><Label className="text-[11px]">{key === 'x' ? 'X' : key === 'y' ? 'Y' : key === 'width' ? '宽度' : '高度'}</Label><div className="mt-1 rounded-md border border-border bg-muted/30 px-3 py-2 font-mono text-sm tabular-nums">{region[key]}</div></div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">尚未框选区域</p>}
            </div>
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
          <div className="flex items-center gap-3"><Clock3 className="h-5 w-5 text-primary" /><p className="text-sm text-muted-foreground">{selectingRegion ? '请在屏幕上拖拽框选区域，按 Enter 确认。' : '开始后主窗口会自动隐藏，框选确认后立即录制。'}</p></div>
          <Button size="lg" onClick={() => void startRecording()} disabled={recorder.loading || !isTauri || selectingRegion || startingRecording || !region}><CircleStop className="h-4 w-4" />{startingRecording ? '正在启动…' : '开始录制'}</Button>
        </div>
      </div>
    </div>
  );
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
