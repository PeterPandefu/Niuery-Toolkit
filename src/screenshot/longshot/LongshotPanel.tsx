import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { emitTo } from '@tauri-apps/api/event';
import { stitchLongshot } from '@/lib/longshot-stitch';

/** 面板状态机：连拍中 / 已暂停 / 拼接中 */
type PanelStatus = 'capturing' | 'paused' | 'stitching';

/** 从窗口 URL query 解析捕获区域（CSS 像素） */
function parseRegion() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  return {
    x: Number(params.get('x')) || 0,
    y: Number(params.get('y')) || 0,
    w: Number(params.get('w')) || 0,
    h: Number(params.get('h')) || 0,
  };
}

export default function LongshotPanel() {
  const { t } = useTranslation();
  const [region] = useState(parseRegion);
  const [status, setStatus] = useState<PanelStatus>('capturing');
  const [intervalMs, setIntervalMs] = useState(1000);
  const [frameCount, setFrameCount] = useState(0);
  const [droppedCount, setDroppedCount] = useState<number | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const framesRef = useRef<ImageBitmap[]>([]);
  const inFlightRef = useRef(false);

  // 单次捕获：Rust 端截屏 → base64 → Blob → ImageBitmap
  const captureOnce = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const b64 = await invoke<string>('capture_screen_region', {
        x: region.x,
        y: region.y,
        width: region.w,
        height: region.h,
      });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      framesRef.current.push(bitmap);
      setFrameCount(framesRef.current.length);
      setPreview(`data:image/png;base64,${b64}`);
    } catch (e) {
      console.error('长截图捕获失败', e);
    } finally {
      inFlightRef.current = false;
    }
  }, [region]);

  // 定时连拍（间隔可运行中调整）
  useEffect(() => {
    if (status !== 'capturing') return;
    captureOnce();
    const timer = window.setInterval(captureOnce, intervalMs);
    return () => window.clearInterval(timer);
  }, [status, intervalMs, captureOnce]);

  const closePanel = useCallback(() => {
    invoke('close_longshot_panel').catch(() => {});
  }, []);

  // 结束：拼接 → 发送结果给主窗口 → 关闭面板
  const handleFinish = useCallback(async () => {
    if (framesRef.current.length === 0) {
      closePanel();
      return;
    }
    setStatus('stitching');
    try {
      const { canvas, droppedCount: dropped } = await stitchLongshot(framesRef.current);
      setDroppedCount(dropped);
      const dataUrl = canvas.toDataURL('image/png');
      await emitTo('main', 'longshot-complete', { dataUrl, droppedCount: dropped });
      closePanel();
    } catch (e) {
      console.error('长截图拼接失败', e);
      setStatus('paused');
    }
  }, [closePanel]);

  const handleCancel = useCallback(() => {
    framesRef.current.forEach((f) => f.close());
    framesRef.current = [];
    closePanel();
  }, [closePanel]);

  return (
    <div className="flex h-screen select-none flex-col bg-[#2a2a2a] text-white">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-white/80">
        <span>{t('screenshotEditor.longshot.title')}</span>
        <span className="text-white/50">
          {region.w}×{region.h}
        </span>
      </div>

      {/* 缩略图 + 统计 */}
      <div className="flex items-center gap-2 px-3">
        <div className="h-16 w-24 shrink-0 overflow-hidden rounded border border-white/15 bg-black/40">
          {preview && (
            <img
              src={preview}
              alt=""
              className="h-full w-full object-contain"
              draggable={false}
            />
          )}
        </div>
        <div className="flex flex-col gap-0.5 text-xs">
          <span>
            {t('screenshotEditor.longshot.frames')}：{frameCount}
          </span>
          <span>
            {t('screenshotEditor.longshot.dropped')}：
            {droppedCount === null ? '—' : droppedCount}
          </span>
          <span className="text-white/50">
            {status === 'capturing' && `● ${t('screenshotEditor.longshot.capturing')}`}
            {status === 'paused' && t('screenshotEditor.longshot.paused')}
            {status === 'stitching' && t('screenshotEditor.longshot.stitching')}
          </span>
        </div>
      </div>

      {/* 捕获间隔 */}
      <div className="flex items-center gap-2 px-3 pt-2 text-xs">
        <span className="shrink-0 text-white/70">{t('screenshotEditor.longshot.interval')}</span>
        <input
          type="range"
          min={300}
          max={3000}
          step={100}
          value={intervalMs}
          disabled={status === 'stitching'}
          onChange={(e) => setIntervalMs(Number(e.target.value))}
          className="h-1 w-full accent-[#4488ff]"
        />
        <span className="w-8 shrink-0 text-right text-white/70">
          {(intervalMs / 1000).toFixed(1)}s
        </span>
      </div>

      {/* 操作按钮 */}
      <div className="mt-auto flex items-center gap-1.5 px-3 pb-3">
        <button
          className="flex-1 rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20 disabled:opacity-40"
          disabled={status === 'stitching'}
          onClick={() => setStatus((s) => (s === 'capturing' ? 'paused' : 'capturing'))}
        >
          {status === 'capturing'
            ? t('screenshotEditor.longshot.pause')
            : t('screenshotEditor.longshot.resume')}
        </button>
        <button
          className="flex-1 rounded bg-[#4488ff] px-2 py-1.5 text-xs hover:bg-[#3377ee] disabled:opacity-40"
          disabled={status === 'stitching' || frameCount === 0}
          onClick={handleFinish}
        >
          {status === 'stitching'
            ? t('screenshotEditor.longshot.stitching')
            : t('screenshotEditor.longshot.finish')}
        </button>
        <button
          className="flex-1 rounded bg-white/10 px-2 py-1.5 text-xs hover:bg-white/20 disabled:opacity-40"
          disabled={status === 'stitching'}
          onClick={handleCancel}
        >
          {t('screenshotEditor.longshot.cancel')}
        </button>
      </div>
    </div>
  );
}
