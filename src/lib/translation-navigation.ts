import { getToolById } from '@/registry/tool-registry';
import { useAppStore } from '@/store/app-store';
import { useScreenshotOcrStore } from '@/store/screenshot-ocr-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';

export function openTranslatorWithText(text: string) {
  const normalizedText = text.trim();
  if (!normalizedText) return;

  useScreenshotOcrStore.getState().setPendingTranslation(normalizedText);
  useToolLifecycleStore.getState().startTool('translator');
  const appStore = useAppStore.getState();
  appStore.setActiveTool('translator');
  appStore.addRecentTool('translator');
  const tool = getToolById('translator');
  if (tool) appStore.setActiveCategory(tool.category);
}

export function openScreenshotEditor() {
  useToolLifecycleStore.getState().startTool('screenshot-editor');
  const appStore = useAppStore.getState();
  appStore.setActiveTool('screenshot-editor');
  appStore.addRecentTool('screenshot-editor');
  const tool = getToolById('screenshot-editor');
  if (tool) appStore.setActiveCategory(tool.category);
}
