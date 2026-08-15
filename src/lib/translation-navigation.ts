import { getToolById } from '@/registry/tool-registry';
import { useAppStore } from '@/store/app-store';
import { useScreenshotOcrStore } from '@/store/screenshot-ocr-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import { getCurrentWindow } from '@tauri-apps/api/window';

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
  useToolLifecycleStore.getState().startTool('translator');
  restoreMainWindowForTranslation();
  const appStore = useAppStore.getState();
  appStore.setActiveTool('translator');
  const tool = getToolById('translator');
  if (tool) appStore.setActiveCategory(tool.category);
}

export function openScreenshotEditor() {
  useToolLifecycleStore.getState().startTool('screenshot-editor');
  const appStore = useAppStore.getState();
  appStore.setActiveTool('screenshot-editor');
  const tool = getToolById('screenshot-editor');
  if (tool) appStore.setActiveCategory(tool.category);
}
