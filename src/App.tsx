import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import { useApplyTheme } from '@/hooks/use-theme';
import { Sidebar } from '@/components/layout/Sidebar';
import { ToolPanel } from '@/components/layout/ToolPanel';
import { SearchDialog } from '@/components/layout/SearchDialog';
import { SettingsDialog } from '@/components/layout/SettingsDialog';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotOcrStore } from '@/store/screenshot-ocr-store';
import { openTranslatorWithText } from '@/lib/translation-navigation';
import { openTool } from '@/lib/tool-navigation';
import { NativeFileDropBridge } from '@/components/shared/NativeFileDropBridge';
import { measurePerformance } from '@/lib/performance-diagnostics';

export default function App() {
  // 初始化主题
  useApplyTheme();

  const activeToolId = useAppStore((s) => s.activeToolId);
  const initAlwaysOnTools = useToolLifecycleStore((s) => s.initAlwaysOnTools);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 应用启动时自动加载常驻工具
  useEffect(() => {
    measurePerformance('应用首屏', 'app:render-start');
    initAlwaysOnTools();
  }, [initAlwaysOnTools]);

  const handleSelectTool = openTool;

  useEffect(() => {
    if (!(typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window)) return;
    const cleanups: (() => void)[] = [];
    let disposed = false;
    void listen('open-screen-recorder', () => handleSelectTool('screen-recorder')).then((unlisten) => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    });
    void listen('open-longshot-editor', () => handleSelectTool('screenshot-editor')).then((unlisten) => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    });
    void listen<{ imageDataUrl: string; text: string; translate?: boolean }>('open-screenshot-ocr', (event) => {
      const { imageDataUrl, text, translate } = event.payload;
      if (!imageDataUrl) return;
      if (translate && text.trim()) {
        // 翻译页不需要提前加载截图；保留会话供“返回截图”使用。
        openTranslatorWithText(text);
        useScreenshotOcrStore.getState().setScreenshotSession({ imageDataUrl, text: text ?? '' });
        return;
      }
      useScreenshotOcrStore.getState().setScreenshotSession({ imageDataUrl, text: text ?? '' });
      handleSelectTool('screenshot-editor');
    }).then((unlisten) => {
      if (disposed) unlisten();
      else cleanups.push(unlisten);
    });
    return () => {
      disposed = true;
      cleanups.forEach((un) => un());
    };
  }, [handleSelectTool]);

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background">
      <Sidebar onSelectTool={handleSelectTool} />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <ToolPanel toolId={activeToolId} onOpenSettings={() => setSettingsOpen(true)} />
      </div>
      <SearchDialog onSelectTool={handleSelectTool} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster position="bottom-right" richColors closeButton />
      <NativeFileDropBridge />
    </div>
  );
}
