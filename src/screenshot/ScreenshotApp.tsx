import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { ScreenshotOverlay } from './ScreenshotOverlay';

interface ScreenshotCapture {
  generation: number;
  mode: 'normal' | 'longshot';
  path: string;
}

interface ScreenshotCaptureReady {
  generation: number;
}

interface ScreenData {
  image: HTMLImageElement;
  width: number;
  height: number;
  generation: number;
  mode: ScreenshotCapture['mode'];
}

/**
 * 可跨截图会话复用的窗口根组件。
 * 窗口在应用启动时隐藏预热，收到后端捕获事件后才加载图片并显示。
 */
export default function ScreenshotApp() {
  const [screen, setScreen] = useState<ScreenData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingGeneration = useRef(0);
  const shownGeneration = useRef(0);

  const loadCapture = useCallback(async (expectedGeneration?: number) => {
    try {
      const capture = await invoke<ScreenshotCapture | null>('get_screen_capture');
      if (!capture || (expectedGeneration !== undefined && capture.generation !== expectedGeneration)) {
        return;
      }

      const generation = capture.generation;
      loadingGeneration.current = generation;
      shownGeneration.current = 0;
      setError(null);
      const image = new Image();
      // 截图由 asset.localhost 提供，与 WebView 页面不同源。必须在赋值 src 前启用
      // 匿名跨域，否则图片绘入 canvas 后会污染画布，首次拖动框选即抛出异常。
      image.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('图片解码失败'));
        image.src = convertFileSrc(capture.path);
      });
      if (loadingGeneration.current !== generation) return;
      setScreen({
        image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        generation,
        mode: capture.mode,
      });
    } catch (reason) {
      if (expectedGeneration !== undefined && loadingGeneration.current !== expectedGeneration) return;
      setError(String(reason));
      const generation = expectedGeneration ?? loadingGeneration.current;
      await invoke('close_screenshot_window', generation > 0 ? { generation } : {}).catch((closeReason) => {
        console.error('隐藏加载失败的截图窗口时出错', closeReason);
      });
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void listen<ScreenshotCaptureReady>('screenshot-capture-ready', (event) => {
      if (!disposed) void loadCapture(event.payload.generation);
    }).then((cleanup) => {
      if (disposed) {
        cleanup();
        return;
      }
      unlisten = cleanup;
      // 监听器注册后再读取一次，覆盖预热页面与首次捕获事件并发的情况。
      // 此时只能预热 WebView，不能让隐藏窗口提前进入全屏；Windows 会将它
      // 视为可见的透明顶层窗口，导致首个鼠标按下无法进入框选层。
      void loadCapture();
    });

    return () => {
      disposed = true;
      loadingGeneration.current += 1;
      unlisten?.();
    };
  }, [loadCapture]);

  useEffect(() => {
    if (!screen || shownGeneration.current === screen.generation) return;
    shownGeneration.current = screen.generation;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const tryShow = (retries = 3) => {
      invoke('show_screenshot_window', { generation: screen.generation }).catch(() => {
        if (cancelled || retries === 0) return;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!cancelled) tryShow(retries - 1);
        }, 100);
      });
    };

    // useEffect 在图片节点提交后运行，预热窗口可直接显示，无需额外等待合成帧。
    tryShow();

    return () => {
      cancelled = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [screen]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-black/80">
        <p className="text-sm text-red-400">截图加载失败：{error}</p>
      </div>
    );
  }

  if (!screen) {
    return <div className="h-screen w-screen" />;
  }

  return (
    <ScreenshotOverlay
      key={screen.generation}
      generation={screen.generation}
      screenImage={screen.image}
      screenW={screen.width}
      screenH={screen.height}
      longshotMode={screen.mode === 'longshot'}
    />
  );
}
