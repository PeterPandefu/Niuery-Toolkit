import { useEffect } from 'react';

/**
 * 被原生 gdigrab 采集的点击穿透光标高亮层。窗口位置由 Rust 端按系统鼠标坐标更新，
 * 因此环与真实光标在多显示器的物理像素坐标中保持一致。
 */
export default function CursorHighlightOverlay() {
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
  }, []);

  return (
    <div
      data-testid="recording-cursor-highlight"
      aria-label="录制光标高亮"
      className="h-screen w-screen rounded-full border-4 border-red-500 bg-red-500/25 shadow-[0_0_0_3px_rgba(255,255,255,0.75),0_0_20px_rgba(239,68,68,0.95)]"
    />
  );
}
