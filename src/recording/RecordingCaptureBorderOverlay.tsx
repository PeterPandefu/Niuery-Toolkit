import { useEffect } from 'react';

/**
 * 录制范围的独立透明边框层。窗口物理边界由 Rust 放在采集矩形外侧，
 * 因而此元素不会被录制到视频中。
 */
export default function RecordingCaptureBorderOverlay() {
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
  }, []);

  return <div data-testid="recording-capture-border" className="recording-capture-border" aria-hidden="true" />;
}
