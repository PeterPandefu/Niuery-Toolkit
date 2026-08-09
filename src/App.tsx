import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import { useApplyTheme } from '@/hooks/use-theme';
import { Sidebar } from '@/components/layout/Sidebar';
import { ToolPanel } from '@/components/layout/ToolPanel';
import { SearchDialog } from '@/components/layout/SearchDialog';
import { SettingsDialog } from '@/components/layout/SettingsDialog';
import { getToolById } from '@/registry/tool-registry';
import { listen } from '@tauri-apps/api/event';
import { useScreenshotOcrStore } from '@/store/screenshot-ocr-store';
import { openTranslatorWithText } from '@/lib/translation-navigation';

export default function App() {
  // 初始化主题
  useApplyTheme();

  const { activeToolId, setActiveTool, addRecentTool, setActiveCategory } = useAppStore();
  const startTool = useToolLifecycleStore((s) => s.startTool);
  const initAlwaysOnTools = useToolLifecycleStore((s) => s.initAlwaysOnTools);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 应用启动时自动加载常驻工具
  useEffect(() => {
    initAlwaysOnTools();
  }, [initAlwaysOnTools]);

  const handleSelectTool = useCallback(
    (toolId: string) => {
      startTool(toolId);
      setActiveTool(toolId);
      addRecentTool(toolId);
      // 自动展开工具所属分类面板
      const tool = getToolById(toolId);
      if (tool) {
        setActiveCategory(tool.category);
      }
    },
    [startTool, setActiveTool, addRecentTool, setActiveCategory]
  );

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
      useScreenshotOcrStore.getState().setScreenshotSession({ imageDataUrl, text: text ?? '' });
      handleSelectTool('screenshot-editor');
      if (translate && text.trim()) openTranslatorWithText(text);
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
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar onSelectTool={handleSelectTool} />
      <div className="flex-1 overflow-hidden">
        <ToolPanel toolId={activeToolId} onOpenSettings={() => setSettingsOpen(true)} />
      </div>
      <SearchDialog onSelectTool={handleSelectTool} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
