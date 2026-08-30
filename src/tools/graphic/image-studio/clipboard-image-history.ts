export interface ClipboardImageEntry {
  id: string;
  content_type: 'text' | 'image' | 'files';
  image_thumbnail: string | null;
  preview: string;
  timestamp: number;
}

/** 从桌面端历史记录读取完整 PNG，并转换为可交给图片工具处理的 File。 */
export async function loadClipboardImageFile(id: string, timestamp: number): Promise<File> {
  const { invoke } = await import('@tauri-apps/api/core');
  const base64 = await invoke<string>('get_clipboard_image', { id });
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new File([bytes], `剪贴板图片-${new Date(timestamp).toISOString().replace(/[:.]/g, '-')}.png`, {
    type: 'image/png',
    lastModified: timestamp,
  });
}

/** 每次使用前读取，避免把“最新图片”固定在打开工具时的旧状态。 */
export async function loadClipboardImageHistory(): Promise<ClipboardImageEntry[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  const entries = await invoke<ClipboardImageEntry[]>('get_clipboard_history');
  return entries.filter((entry) => entry.content_type === 'image');
}

/** 异步补齐指定图片的缩略图，不阻塞历史记录元数据展示。 */
export async function loadClipboardImageThumbnails(entries: ClipboardImageEntry[]): Promise<ClipboardImageEntry[]> {
  const { invoke } = await import('@tauri-apps/api/core');
  return Promise.all(entries.map(async (entry) => {
    if (entry.image_thumbnail) return entry;
    try {
      const imageThumbnail = await invoke<string | null>('get_clipboard_thumbnail', { id: entry.id });
      return imageThumbnail ? { ...entry, image_thumbnail: imageThumbnail } : entry;
    } catch {
      return entry;
    }
  }));
}

export function formatClipboardRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}
