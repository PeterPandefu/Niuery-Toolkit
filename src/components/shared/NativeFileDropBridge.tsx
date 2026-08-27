import { useEffect } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

type DroppedFileEvent = {
  type: 'drop';
  paths: string[];
  position: { x: number; y: number };
};

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || 'dropped-file';
}

async function loadDroppedFile(path: string): Promise<File> {
  const response = await fetch(convertFileSrc(path));
  if (!response.ok) throw new Error(`无法读取文件: ${fileName(path)}`);
  const blob = await response.blob();
  return new File([blob], fileName(path), { type: blob.type || 'application/octet-stream', lastModified: Date.now() });
}

function dispatchDrop(target: Element, files: File[]) {
  const dataTransfer = typeof DataTransfer !== 'undefined' ? new DataTransfer() : null;
  if (dataTransfer) files.forEach((file) => dataTransfer.items.add(file));
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer ?? { files } });
  target.dispatchEvent(event);
}

/**
 * Tauri's OS file drag-and-drop is delivered as a webview event (paths), not
 * as an HTML5 DragEvent. Convert it back into a normal drop event so every
 * existing tool handler receives the same File objects as file selection.
 */
export function NativeFileDropBridge() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

    let disposed = false;
    const webview = getCurrentWebview();
    const unlistenPromise = webview.onDragDropEvent(async (event) => {
      const payload = event.payload as DroppedFileEvent;
      if (payload.type !== 'drop' || payload.paths.length === 0 || disposed) return;

      // Tauri reports physical pixels; elementFromPoint expects CSS pixels.
      const scale = window.devicePixelRatio || 1;
      const target = document.elementFromPoint(payload.position.x / scale, payload.position.y / scale);
      if (!target) return;

      try {
        const files = await Promise.all(payload.paths.map(loadDroppedFile));
        if (!disposed) dispatchDrop(target, files);
      } catch {
        // Individual tools handle invalid files; a failed path should not
        // break the global drag listener for subsequent drops.
      }
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  return null;
}
