import { useCallback } from 'react';
import { Toaster } from 'sonner';
import { useAppStore } from '@/store/app-store';
import { useTheme } from '@/hooks/use-theme';
import { Sidebar } from '@/components/layout/Sidebar';
import { ToolPanel } from '@/components/layout/ToolPanel';
import { SearchDialog } from '@/components/layout/SearchDialog';
import { getToolById } from '@/registry/tool-registry';

export default function App() {
  // 初始化主题
  useTheme();

  const { activeToolId, setActiveTool, addRecentTool, setActiveCategory } = useAppStore();

  const handleSelectTool = useCallback(
    (toolId: string) => {
      setActiveTool(toolId);
      addRecentTool(toolId);
      // 自动展开工具所属分类面板
      const tool = getToolById(toolId);
      if (tool) {
        setActiveCategory(tool.category);
      }
    },
    [setActiveTool, addRecentTool, setActiveCategory]
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar onSelectTool={handleSelectTool} />
      <div className="flex-1 overflow-hidden">
        <ToolPanel toolId={activeToolId} />
      </div>
      <SearchDialog onSelectTool={handleSelectTool} />
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
