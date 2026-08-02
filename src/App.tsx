import { useCallback, useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import { useTheme } from '@/hooks/use-theme';
import { Sidebar } from '@/components/layout/Sidebar';
import { ToolPanel } from '@/components/layout/ToolPanel';
import { SearchDialog } from '@/components/layout/SearchDialog';
import { SettingsDialog } from '@/components/layout/SettingsDialog';
import { getToolById } from '@/registry/tool-registry';

export default function App() {
  // 初始化主题
  useTheme();

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
