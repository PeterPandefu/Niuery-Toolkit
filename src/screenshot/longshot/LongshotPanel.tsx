import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { stitchLongshot } from '@/lib/longshot-stitch';

/** 从窗口 URL query 解析捕获区域（CSS 像素）、捕获间隔与滚动模式（框选阶段已确认，不可修改） */
function parseRegion() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const rawInterval = Number(params.get('i')) || 1000;
  return {
    x: Number(params.get('x')) || 0,
    y: Number(params.get('y')) || 0,
    w: Number(params.get('w')) || 0,
    h: Number(params.get('h')) || 0,
    i: Math.min(3000, Math.max(300, rawInterval)),
    a: params.get('a') !== '0',
  };
}

/** 自动滚动：滚轮发送后等待平滑滚动动画稳定的时间 */
const AUTO_SETTLE_MS = 350;
/** 连续相同帧达到该次数视为已滚到底部，自动结束 */
const BOTTOM_SAME_STREAK = 2;
/** 帧数保护上限 */
const MAX_FRAMES = 3000;

/**
 * 长截图呼吸边框窗口：透明、光标穿透，仅以呼吸边框标示捕获区域。
 * 连拍循环在本 webview 内运行；全局 Esc（Rust 转发 longshot-esc 事件）结束并拼接。
 */
export default function LongshotPanel() {
  const [region] = useState(parseRegion);
  const framesRef = useRef<ImageBitmap[]>([]);
  const inFlightRef = useRef(false);
  const finishingRef = useRef(false);
  const lastB64Ref = useRef<string | null>(null);
  const sameStreakRef = useRef(0);
  const firstTickRef = useRef(true);

  // 单次捕获：Rust 端截屏 → base64 → Blob → ImageBitmap；返回 base64 用于底部检测
  const captureOnce = useCallback(async (): Promise<string | null> => {
    if (inFlightRef.current || finishingRef.current) return null;
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
      return b64;
    } catch (e) {
      console.error('长截图捕获失败', e);
      return null;
    } finally {
      inFlightRef.current = false;
    }
  }, [region]);

  const closePanel = useCallback(() => {
    invoke('close_longshot_panel').catch(() => {});
  }, []);

  // 结束：拼接 → 发送结果给主窗口 → 关闭边框窗口（主窗口负责恢复与提示）
  const handleFinish = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    try {
      if (framesRef.current.length > 0) {
        // 自动滚动 dy 近似恒定用紧容差；手动滚动速度多变用宽容差
        const { canvas, droppedCount } = await stitchLongshot(
          framesRef.current,
          region.a ? 0.3 : 0.6,
        );
        const dataUrl = canvas.toDataURL('image/png');
        await emitTo('main', 'longshot-complete', { dataUrl, droppedCount });
      }
    } catch (e) {
      console.error('长截图拼接失败', e);
    } finally {
      closePanel();
    }
  }, [closePanel, region.a]);

  // 连拍循环：自动模式每 tick 先滚一个 notch、等动画稳定再拍；
  // 首 tick 不滚动，保证第一帧为当前视口。连续相同帧视为到底，自动结束
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (finishingRef.current) return;
      if (region.a && !firstTickRef.current) {
        try {
          await invoke('send_scroll_wheel', {
            x: region.x + region.w / 2,
            y: region.y + region.h / 2,
            notches: 1,
          });
        } catch (e) {
          console.error('自动滚动发送失败', e);
        }
        await new Promise((r) => setTimeout(r, AUTO_SETTLE_MS));
      }
      firstTickRef.current = false;
      if (cancelled || finishingRef.current) return;
      const b64 = await captureOnce();
      if (b64 === null || cancelled) return;
      if (b64 === lastB64Ref.current) {
        sameStreakRef.current += 1;
      } else {
        sameStreakRef.current = 0;
        lastB64Ref.current = b64;
      }
      if (sameStreakRef.current >= BOTTOM_SAME_STREAK || framesRef.current.length >= MAX_FRAMES) {
        void handleFinish();
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), region.i);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [captureOnce, handleFinish, region]);

  // 监听 Rust 端临时全局 Esc 转发的事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen('longshot-esc', () => {
      void handleFinish();
    }).then((un) => {
      unlisten = un;
    });
    return () => unlisten?.();
  }, [handleFinish]);

  return <div className="longshot-border" aria-hidden />;
}
