import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ScreenshotOverlay } from './ScreenshotOverlay';

interface ScreenData {
  image: HTMLImageElement;
  width: number;
  height: number;
}

/**
 * 截图窗口根组件
 * 从 Rust 后端获取已捕获的屏幕截图，然后渲染全屏覆盖层
 */
export default function ScreenshotApp() {
  const [screen, setScreen] = useState<ScreenData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // 显示窗口的辅助函数（带重试）
    const showWindow = () => {
      const tryShow = (retries = 3) => {
        invoke('show_screenshot_window').catch(() => {
          if (retries > 0) setTimeout(() => tryShow(retries - 1), 100);
        });
      };
      tryShow();
    };

    // 后备定时器：无论 async 流程如何，最多 2s 后强制显示窗口
    const fallbackTimer = setTimeout(() => {
      if (!cancelled) showWindow();
    }, 2000);

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
      } finally {
        clearTimeout(fallbackTimer);
        if (!cancelled) showWindow();
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
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
    />
  );
}
