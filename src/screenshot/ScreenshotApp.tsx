import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ScreenshotOverlay } from './ScreenshotOverlay';

interface ScreenData {
  image: HTMLImageElement;
  width: number;
  height: number;
}

// 长截图模式由 Rust 端通过 URL 查询参数传入：#/screenshot?mode=longshot
const isLongshotMode = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('mode') === 'longshot';

/**
 * 截图窗口根组件
 * 从 Rust 后端获取已捕获的屏幕截图，然后渲染全屏覆盖层
 */
export default function ScreenshotApp() {
  const [screen, setScreen] = useState<ScreenData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasShownWindow = useRef(false);
  const hasClosedFailedWindow = useRef(false);

  useEffect(() => {
    if (!screen || hasShownWindow.current) return;
    hasShownWindow.current = true;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;

    const tryShow = (retries = 3) => {
      invoke('show_screenshot_window').catch(() => {
        if (cancelled || retries === 0) return;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!cancelled) tryShow(retries - 1);
        }, 100);
      });
    };

    // 隐藏的 WebView 提交 React 内容后，再等待两帧交给系统合成器，
    // 避免透明置顶窗口先显示、截图提示尚未绘制而看起来像整个桌面卡死。
    firstFrame = requestAnimationFrame(() => {
      firstFrame = null;
      secondFrame = requestAnimationFrame(() => {
        secondFrame = null;
        if (!cancelled) tryShow();
      });
    });

    return () => {
      cancelled = true;
      if (firstFrame !== null) cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) cancelAnimationFrame(secondFrame);
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [screen]);

  useEffect(() => {
    if (!error || hasClosedFailedWindow.current) return;
    hasClosedFailedWindow.current = true;
    // 图片加载失败时窗口仍处于隐藏状态，直接关闭，绝不留下透明置顶拦截层。
    invoke('close_screenshot_window').catch((reason) => {
      console.error('关闭失败的截图窗口时出错', reason);
    });
  }, [error]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const base64 = await invoke<string>('get_screen_capture');
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('图片解码失败'));
          img.src = `data:image/png;base64,${base64}`;
        });
        if (!cancelled) {
          setScreen({ image: img, width: img.naturalWidth, height: img.naturalHeight });
        }
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-black/80">
        <p className="text-sm text-red-400">截图加载失败：{error}</p>
      </div>
    );
  }

  if (!screen) {
    // 透明加载状态（窗口本身是透明的，不会看到白屏）
    return <div className="h-screen w-screen" />;
  }

  return (
    <ScreenshotOverlay
      screenImage={screen.image}
      screenW={screen.width}
      screenH={screen.height}
      longshotMode={isLongshotMode}
    />
  );
}
