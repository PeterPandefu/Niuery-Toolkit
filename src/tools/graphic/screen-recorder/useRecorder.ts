import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createLogger } from '@/lib/logger';
import type {
  AudioSource,
  CaptureTarget,
  MonitorInfo,
  RecordingArtifact,
  RecordingSession,
  RecordingSettings,
  RecordingStatusEvent,
  WindowInfo,
} from './types';

interface RecorderApiOptions {
  onStatus?: (event: RecordingStatusEvent) => void;
}

const log = createLogger('screen-recorder:recorder');

export function useRecorder({ onStatus }: RecorderApiOptions = {}) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [audioSources, setAudioSources] = useState<AudioSource[]>([]);
  const [sourceErrors, setSourceErrors] = useState<{ monitors?: string; windows?: string; audio?: string }>({});
  const [refreshingSources, setRefreshingSources] = useState(false);
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [artifact, setArtifact] = useState<RecordingArtifact | null>(null);
  const [status, setStatus] = useState<RecordingStatusEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onStatusRef = useRef(onStatus);
  const lastSessionIdRef = useRef<string | null>(null);
  const terminalSessionRef = useRef<string | null>(null);
  onStatusRef.current = onStatus;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<RecordingStatusEvent>('recording-status', (event) => {
      const nextStatus = event.payload;
      if (nextStatus.status === 'stopped' || nextStatus.status === 'error') terminalSessionRef.current = nextStatus.sessionId;
      if (nextStatus.status === 'stopped' && nextStatus.artifact) {
        lastSessionIdRef.current = nextStatus.sessionId;
        setSession(null);
        setArtifact(nextStatus.artifact);
      }
      if (nextStatus.status === 'error') setSession(null);
      setStatus(nextStatus);
      onStatusRef.current?.(nextStatus);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => unlisten?.();
  }, []);

  const refreshSources = useCallback(async () => {
    setRefreshingSources(true);
    try {
      const [monitorResult, windowResult, audioResult] = await Promise.allSettled([
        invoke<MonitorInfo[]>('list_capture_monitors'),
        invoke<WindowInfo[]>('list_capture_windows'),
        invoke<AudioSource[]>('list_audio_sources'),
      ]);
      const nextMonitors = monitorResult.status === 'fulfilled' ? monitorResult.value : [];
      const nextWindows = windowResult.status === 'fulfilled' ? windowResult.value : [];
      const nextAudio = audioResult.status === 'fulfilled' ? audioResult.value : [];
      const message = (result: PromiseSettledResult<unknown>) => result.status === 'rejected' ? String(result.reason instanceof Error ? result.reason.message : result.reason) : undefined;
      setSourceErrors({ monitors: message(monitorResult), windows: message(windowResult), audio: message(audioResult) });
      setMonitors(nextMonitors);
      setWindows(nextWindows);
      setAudioSources(nextAudio);
      return { monitors: nextMonitors, windows: nextWindows, audioSources: nextAudio };
    } finally {
      setRefreshingSources(false);
    }
  }, []);

  const start = useCallback(async (target: CaptureTarget, settings: RecordingSettings) => {
    terminalSessionRef.current = null;
    setLoading(true);
    setError(null);
    try {
      log.info('开始录制', { mode: target.mode, fps: settings.fps, quality: settings.quality });
      const nextSession = await invoke<RecordingSession>('start_recording', { target, settings });
      if (terminalSessionRef.current !== nextSession.id) {
        setSession(nextSession);
        setArtifact(null);
      }
      log.info('录制会话已创建', { sessionId: nextSession.id, mode: target.mode });
      return nextSession;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      log.error('开始录制失败', { mode: target.mode, error: message });
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const pause = useCallback(async () => {
    if (!session) return false;
    try {
      await invoke('pause_recording', { sessionId: session.id });
      return true;
    } catch (reason) {
      log.warn('暂停录制失败', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [session]);

  const resume = useCallback(async () => {
    if (!session) return false;
    try {
      await invoke('resume_recording', { sessionId: session.id });
      return true;
    } catch (reason) {
      log.warn('继续录制失败', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [session]);

  const stop = useCallback(async () => {
    if (!session) return null;
    setLoading(true);
    try {
      log.info('停止录制', { sessionId: session.id });
      const nextArtifact = await invoke<RecordingArtifact>('stop_recording', { sessionId: session.id });
      setArtifact(nextArtifact);
      lastSessionIdRef.current = session.id;
      setSession(null);
      log.info('录制文件已生成', {
        path: nextArtifact.path,
        durationMs: nextArtifact.durationMs,
        requestedFps: nextArtifact.requestedFps,
        fps: nextArtifact.fps,
        quality: nextArtifact.quality,
        captureBackend: nextArtifact.captureBackend,
        width: nextArtifact.width,
        height: nextArtifact.height,
        sizeBytes: nextArtifact.sizeBytes,
      });
      return nextArtifact;
    } catch (reason) {
      log.error('停止录制失败', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setLoading(false);
    }
  }, [session]);

  const revealInFolder = useCallback(async () => {
    const currentSessionId = session?.id ?? lastSessionIdRef.current;
    if (!currentSessionId) return false;
    try {
      await invoke('reveal_recording_in_folder', { sessionId: currentSessionId });
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      log.warn('定位录制文件失败', { sessionId: currentSessionId, error: message });
      setError(message);
      return false;
    }
  }, [session]);

  const cancel = useCallback(async () => {
    if (!session) return true;
    try {
      await invoke('cancel_recording', { sessionId: session.id });
      setSession(null);
      setArtifact(null);
      lastSessionIdRef.current = null;
      return true;
    } catch (reason) {
      log.warn('取消录制失败', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [session]);

  const exportRecording = useCallback(async (
    format: 'mp4' | 'gif',
    options: Record<string, unknown> = {},
    outputPath?: string,
  ) => {
    const currentSessionId = session?.id ?? lastSessionIdRef.current;
    if (!currentSessionId && !artifact) return null;
    setError(null);
    const startedAt = Date.now();
    log.info('导出录制开始', {
      format,
      options,
      sessionId: currentSessionId,
      hasArtifact: Boolean(artifact),
    });
    try {
      const result = await invoke<{ path: string; format: 'mp4' | 'gif'; sizeBytes?: number; warning?: string }>('export_recording', {
        sessionId: currentSessionId ?? '',
        format,
        options,
        outputPath,
      });
      log.info('录制导出完成', {
        format,
        path: result.path,
        sizeBytes: result.sizeBytes,
        warning: result.warning,
        elapsedMs: Date.now() - startedAt,
      });
      return result;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      // 后端会将 FFmpeg 的末尾诊断整理为可操作的错误文本；日志和界面必须保留它，
      // 不能再把真实失败原因折叠成泛化的“GIF 导出失败”。
      log.error('导出录制失败', { format, options, elapsedMs: Date.now() - startedAt, error: message });
      setError(message);
      throw new Error(message);
    }
  }, [artifact, session]);

  const prepareGifEditor = useCallback(async () => {
    const currentSessionId = session?.id ?? lastSessionIdRef.current;
    if (!currentSessionId) return null;
    try {
      return await invoke<{ path: string; sizeBytes: number; warning?: string }>('prepare_gif_editor', { sessionId: currentSessionId });
    } catch (reason) {
      log.warn('准备 GIF 编辑器失败', reason);
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }, [session]);

  const loadPreview = useCallback(() => {
    if (!artifact) return null;
    // 录制缓存位于受限的 assetProtocol 范围内。直接交给 WebView 读取可以保留原始
    // MP4 字节，避免 IPC 原始响应在不同运行时的表示差异破坏 Blob 内容。
    return convertFileSrc(artifact.path);
  }, [artifact]);

  return {
    monitors,
    windows,
    audioSources,
    sourceErrors,
    refreshingSources,
    session,
    artifact,
    status,
    loading,
    error,
    refreshSources,
    start,
    pause,
    resume,
    stop,
    cancel,
    exportRecording,
    revealInFolder,
    prepareGifEditor,
    loadPreview,
    clearError: () => setError(null),
    hasFinished: (sessionId: string) => terminalSessionRef.current === sessionId,
  };
}
