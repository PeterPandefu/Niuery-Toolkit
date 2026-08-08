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
    <div className="relative h-screen w-screen" aria-hidden="true">
      <div
        data-testid="recording-cursor-highlight"
        aria-label="录制光标高亮"
        className="absolute left-1/2 top-1/2 h-[22px] w-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-500 bg-red-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.85),0_0_8px_rgba(239,68,68,0.45)]"
      />
    </div>
  );
}
