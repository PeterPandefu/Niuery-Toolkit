import { useLayoutEffect, useRef } from 'react';

/**
 * 录制范围的独立透明边框层。窗口物理边界由 Rust 放在采集矩形外侧，
 * 因而此元素不会被录制到视频中。
 */
export default function RecordingCaptureBorderOverlay() {
  const borderRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';

    let resolution: MediaQueryList;
    const updateBorderWidth = () => {
      // Rust 将窗口向外扩 3 个物理像素；CSS 像素必须按当前 DPI 换算，
      // 否则系统缩放会使边框内沿进入录制区域。
      const scale = window.devicePixelRatio || 1;
      borderRef.current?.style.setProperty('--recording-border-width', `${3 / scale}px`);
      resolution?.removeEventListener('change', updateBorderWidth);
      resolution = window.matchMedia(`(resolution: ${scale}dppx)`);
      resolution.addEventListener('change', updateBorderWidth);
    };
    updateBorderWidth();
    window.addEventListener('resize', updateBorderWidth);
    return () => {
      resolution.removeEventListener('change', updateBorderWidth);
      window.removeEventListener('resize', updateBorderWidth);
    };
  }, []);

  return <div ref={borderRef} data-testid="recording-capture-border" className="recording-capture-border" aria-hidden="true" />;
}
