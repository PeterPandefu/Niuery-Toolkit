import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import {
  getAllTools,
  getAvailableCategories,
  getToolsByCategory,
} from '@/registry/tool-registry';
import { ToolCategory } from '@/types/tool';
import { Clock, PanelLeftClose, PanelLeft, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SidebarProps {
  onSelectTool: (toolId: string) => void;
}

export function Sidebar({ onSelectTool }: SidebarProps) {
  const { t } = useTranslation();
  const { sidebarCollapsed, toggleSidebar, activeToolId, recentTools } = useAppStore();
  const categories = getAvailableCategories();

  const recentToolList = useMemo(() => {
    const allTools = getAllTools();
    return recentTools
      .map((id) => allTools.find((t) => t.id === id))
      .filter(Boolean)
      .slice(0, 5);
  }, [recentTools]);

  if (sidebarCollapsed) {
    return (
      <div className="flex h-full w-14 flex-col items-center border-r bg-sidebar py-3">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="mb-4">
          <PanelLeft className="h-5 w-5" />
        </Button>
        <div className="flex flex-col items-center gap-2">
          {categories.map((category) => {
            const tools = getToolsByCategory(category);
            const FirstIcon = tools[0]?.icon || Wrench;
            return (
              <Button
                key={category}
                variant="ghost"
                size="icon"
                className="text-muted-foreground"
                title={t(`categories.${category}`)}
                onClick={() => tools[0] && onSelectTool(tools[0].id)}
              >
                <FirstIcon className="h-5 w-5" />
              </Button>
            );
          })}
        </div>
        <div className="mt-auto text-[10px] text-muted-foreground/60">
          v{__APP_VERSION__}
        </div>
      </div>
    );
  }

  return (
    <nav className="flex h-full w-64 flex-col border-r bg-sidebar" aria-label="Tool navigation">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="font-semibold">Niuery Toolkit</span>
        </div>
        <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label="Collapse sidebar">
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Recent Tools */}
      {recentToolList.length > 0 && (
        <div className="px-3 pb-2">
          <div className="mb-1 flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
            <Clock className="h-3 w-3" />
            {t('app.recentTools')}
          </div>
          <div className="space-y-0.5">
            {recentToolList.map((tool) => {
              if (!tool) return null;
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => onSelectTool(tool.id)}
                  aria-current={activeToolId === tool.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent',
                    activeToolId === tool.id && 'bg-sidebar-accent font-medium'
                  )}
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {t(`tools.${tool.id}`, tool.name)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tool Categories */}
      <div className="flex-1 overflow-y-auto px-3 pb-4" role="list" aria-label="Tools by category">
        {categories.map((category: ToolCategory) => {
          const tools = getToolsByCategory(category);
          return (
            <div key={category} className="mb-3">
              <div className="mb-1 px-2 text-xs font-medium text-muted-foreground">
                {t(`categories.${category}`)}
              </div>
              <div className="space-y-0.5">
                {tools.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => onSelectTool(tool.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent',
                      activeToolId === tool.id && 'bg-sidebar-accent font-medium'
                    )}
                  >
                    <tool.icon className="h-4 w-4 text-muted-foreground" />
                    {t(`tools.${tool.id}`, tool.name)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Version Footer */}
      <div className="border-t px-4 py-2.5">
        <span className="text-xs text-muted-foreground/70">v{__APP_VERSION__}</span>
      </div>
    </nav>
  );
}
