import { useScreenshotOcrStore } from '@/store/screenshot-ocr-store';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openTool } from '@/lib/tool-navigation';

function restoreMainWindowForTranslation() {
  if (!(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)) return;

  const mainWindow = getCurrentWindow();
  void (async () => {
    try {
      await mainWindow.show();
      await mainWindow.unminimize();
      await mainWindow.setFocus();
    } catch {
      // 窗口恢复失败不应阻断翻译状态交接；全局“显示窗口”快捷键仍可恢复窗口。
    }
  })();
}

export function openTranslatorWithText(text: string) {
  const normalizedText = text.trim();
  if (!normalizedText) return;

  useScreenshotOcrStore.getState().setPendingTranslation(normalizedText);
  openTool('translator');
  restoreMainWindowForTranslation();
}

export function openScreenshotEditor() {
  openTool('screenshot-editor');
}
