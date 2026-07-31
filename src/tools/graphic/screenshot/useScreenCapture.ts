import { useCallback, useState } from 'react';
import { toast } from 'sonner';

/**
 * 屏幕捕获 Hook
 * 使用 Screen Capture API 捕获一帧画面
 */
export function useScreenCapture() {
  const [capturing, setCapturing] = useState(false);

  const isSupported = typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    !!navigator.mediaDevices.getDisplayMedia;

  const capture = useCallback(async (): Promise<HTMLImageElement | null> => {
    if (!isSupported) {
      toast.error('当前浏览器不支持屏幕捕获');
      return null;
    }

    setCapturing(true);
    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings();
      const width = settings.width || 1920;
      const height = settings.height || 1080;

      // 创建 video 元素获取帧
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      // 等待一帧渲染
      await new Promise((r) => requestAnimationFrame(r));

      // 绘制到 canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, width, height);

      // 停止流
      track.stop();
      stream = null;

      // 转为 Image
      const img = new Image();
      const dataUrl = canvas.toDataURL('image/png');
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = dataUrl;
      });

      toast.success('截屏成功');
      return img;
    } catch (err) {
      // 用户取消不提示错误
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        return null;
      }
      toast.error('截屏失败');
      return null;
    } finally {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      setCapturing(false);
    }
  }, [isSupported]);

  return { capture, capturing, isSupported };
}
