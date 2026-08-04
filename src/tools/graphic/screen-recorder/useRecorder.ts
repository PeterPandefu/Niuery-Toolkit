import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
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

export function useRecorder({ onStatus }: RecorderApiOptions = {}) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [audioSources, setAudioSources] = useState<AudioSource[]>([]);
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [artifact, setArtifact] = useState<RecordingArtifact | null>(null);
  const [status, setStatus] = useState<RecordingStatusEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onStatusRef = useRef(onStatus);
  const lastSessionIdRef = useRef<string | null>(null);
  onStatusRef.current = onStatus;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<RecordingStatusEvent>('recording-status', (event) => {
      const nextStatus = event.payload;
      if (nextStatus.status === 'stopped' && nextStatus.artifact) {
        lastSessionIdRef.current = nextStatus.sessionId;
        setSession(null);
        setArtifact(nextStatus.artifact);
      }
      setStatus(nextStatus);
      onStatusRef.current?.(nextStatus);
    }).then((cleanup) => {
      unlisten = cleanup;
    });
    return () => unlisten?.();
  }, []);

  const refreshSources = useCallback(async () => {
    setError(null);
    try {
      const [nextMonitors, nextWindows, nextAudio] = await Promise.all([
        invoke<MonitorInfo[]>('list_capture_monitors'),
        invoke<WindowInfo[]>('list_capture_windows'),
        invoke<AudioSource[]>('list_audio_sources'),
      ]);
      setMonitors(nextMonitors);
      setWindows(nextWindows);
      setAudioSources(nextAudio);
      return { monitors: nextMonitors, windows: nextWindows, audioSources: nextAudio };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      return null;
    }
  }, []);

  const start = useCallback(async (target: CaptureTarget, settings: RecordingSettings) => {
    setLoading(true);
    setError(null);
    try {
      const nextSession = await invoke<RecordingSession>('start_recording', { target, settings });
      setSession(nextSession);
      setArtifact(null);
      return nextSession;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
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
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  }, [session]);

  const stop = useCallback(async () => {
    if (!session) return null;
    setLoading(true);
    try {
      const nextArtifact = await invoke<RecordingArtifact>('stop_recording', { sessionId: session.id });
      setArtifact(nextArtifact);
      lastSessionIdRef.current = session.id;
      setSession(null);
      return nextArtifact;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    } finally {
      setLoading(false);
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
    try {
      return await invoke<{ path: string; format: 'mp4' | 'gif'; sizeBytes?: number }>('export_recording', {
        sessionId: currentSessionId ?? '',
        format,
        options,
        outputPath,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }, [artifact, session]);

  const prepareGifEditor = useCallback(async () => {
    const currentSessionId = session?.id ?? lastSessionIdRef.current;
    if (!currentSessionId) return null;
    try {
      return await invoke<{ path: string; sizeBytes: number }>('prepare_gif_editor', { sessionId: currentSessionId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }, [session]);

  const loadPreview = useCallback(async () => {
    const currentSessionId = lastSessionIdRef.current;
    if (!currentSessionId) return null;
    try {
      const bytes = await invoke<ArrayBuffer>('get_recording_preview', { sessionId: currentSessionId });
      return URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return null;
    }
  }, []);

  return {
    monitors,
    windows,
    audioSources,
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
    prepareGifEditor,
    loadPreview,
    clearError: () => setError(null),
  };
}
