import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

/**
 * 屏幕捕获 Hook
 * 使用 Screen Capture API 捕获一帧画面
 */
export function useScreenCapture() {
  const [capturing, setCapturing] = useState(false);
  const [longCapturing, setLongCapturing] = useState(false);
  const longStreamRef = useRef<MediaStream | null>(null);
  const longVideoRef = useRef<HTMLVideoElement | null>(null);

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

  const stopLongCapture = useCallback(() => {
    longStreamRef.current?.getTracks().forEach((track) => track.stop());
    longStreamRef.current = null;
    if (longVideoRef.current) {
      longVideoRef.current.pause();
      longVideoRef.current.srcObject = null;
    }
    longVideoRef.current = null;
    setLongCapturing(false);
  }, []);

  useEffect(() => stopLongCapture, [stopLongCapture]);

  const startLongCapture = useCallback(async () => {
    if (!isSupported) {
      toast.error('当前环境不支持屏幕捕获');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      longStreamRef.current = stream;
      longVideoRef.current = video;
      stream.getVideoTracks()[0]?.addEventListener('ended', stopLongCapture, { once: true });
      setLongCapturing(true);
      return true;
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) toast.error('长截图启动失败');
      return false;
    }
  }, [isSupported, stopLongCapture]);

  const captureLongFrame = useCallback(async (): Promise<HTMLImageElement | null> => {
    const video = longVideoRef.current;
    if (!video || !longStreamRef.current) return null;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const settings = longStreamRef.current.getVideoTracks()[0]?.getSettings();
    const width = settings?.width || video.videoWidth || 1920;
    const height = settings?.height || video.videoHeight || 1080;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('图片解码失败'));
      image.src = canvas.toDataURL('image/png');
    });
    return image;
  }, []);

  return { capture, capturing, isSupported, longCapturing, startLongCapture, captureLongFrame, stopLongCapture };
}
