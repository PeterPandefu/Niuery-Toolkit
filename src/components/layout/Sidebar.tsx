import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import {
  getAllTools,
  getAvailableCategories,
  getToolsByCategory,
} from '@/registry/tool-registry';
import { ToolCategory, CATEGORY_ICONS } from '@/types/tool';
import { Clock, Home, Pin, Search } from 'lucide-react';
import { BrandMark } from '@/components/shared/BrandMark';

interface SidebarProps {
  onSelectTool: (toolId: string) => void;
}

/** 工具列表条目 */
function ToolItem({
  active,
  icon: Icon,
  label,
  running,
  alwaysOn,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  running?: boolean;
  alwaysOn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-all duration-150',
        'hover:bg-sidebar-accent hover:translate-x-[2px]',
        active
          ? 'bg-sidebar-accent font-medium text-foreground'
          : 'text-sidebar-foreground/75 hover:text-foreground'
      )}
    >
      {/* 活动指示条 */}
      <span
        className={cn(
          'absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-200',
          active ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-50'
        )}
      />
      <Icon
        className={cn(
          'h-4 w-4 shrink-0 transition-colors duration-150',
          active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground/70'
        )}
      />
      <span className="truncate">{label}</span>
      {/* 运行状态指示 */}
      {alwaysOn ? (
        <Pin className="ml-auto h-3 w-3 shrink-0 text-warning/80" />
      ) : running ? (
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-success animate-glow-pulse" />
      ) : null}
    </button>
  );
}

export function Sidebar({ onSelectTool }: SidebarProps) {
  const { t } = useTranslation();
  const {
    activeToolId,
    recentTools,
    setSearchOpen,
    setActiveTool,
    activeCategory,
    setActiveCategory,
  } = useAppStore();
  const activeTools = useToolLifecycleStore((s) => s.activeTools);
  const alwaysOnTools = useToolLifecycleStore((s) => s.alwaysOnTools);
  const categories = getAvailableCategories();

  const recentToolList = useMemo(() => {
    const allTools = getAllTools();
    return recentTools
      .map((id) => allTools.find((tool) => tool.id === id))
      .filter(Boolean)
      .slice(0, 5);
  }, [recentTools]);

  // 当前分类下的工具列表
  const categoryTools = useMemo(() => {
    if (!activeCategory) return [];
    return getToolsByCategory(activeCategory);
  }, [activeCategory]);

  const handleCategoryClick = (category: ToolCategory) => {
    // 切换：再次点击同一分类则收起
    setActiveCategory(activeCategory === category ? null : category);
  };

  const handleHome = () => {
    setActiveTool(null);
    setActiveCategory(null);
  };

  const handleSelectTool = (toolId: string) => {
    onSelectTool(toolId);
  };

  return (
    <div className="flex h-full shrink-0">
      {/* ===== 图标导航栏 (Rail) ===== */}
      <nav
        className="flex h-full w-[56px] flex-col items-center border-r border-sidebar-border bg-sidebar py-3"
        aria-label="Category navigation"
      >
        {/* 品牌标识 */}
        <button
          onClick={handleHome}
          className="mb-1 rounded-lg p-1.5 transition-all duration-150 hover:scale-105 active:scale-95"
          title="Home"
        >
          <BrandMark size={28} />
        </button>

        {/* 首页 */}
        <button
          onClick={handleHome}
          title={t('app.home', '首页')}
          className={cn(
            'relative mb-0.5 rounded-lg p-2.5 transition-all duration-150 hover:bg-sidebar-accent active:scale-90',
            !activeToolId && !activeCategory
              ? 'text-primary bg-sidebar-accent'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Home className="h-[18px] w-[18px]" />
          {!activeToolId && !activeCategory && (
            <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />
          )}
        </button>

        {/* 搜索 */}
        <button
          onClick={() => setSearchOpen(true)}
          title={`${t('app.searchTools')} (Ctrl+K)`}
          className="mb-2 rounded-lg p-2.5 text-muted-foreground transition-all duration-150 hover:bg-sidebar-accent hover:text-foreground active:scale-90"
        >
          <Search className="h-[18px] w-[18px]" />
        </button>

        {/* 分隔线 */}
        <div className="mb-2 h-px w-7 bg-sidebar-border" />

        {/* 分类图标 */}
        <div className="flex flex-1 flex-col items-center gap-0.5 overflow-y-auto">
          {categories.map((category) => {
            const CategoryIcon = CATEGORY_ICONS[category] || Search;
            const isActive = activeCategory === category;
            const hasActiveTool =
              activeToolId != null &&
              getToolsByCategory(category).some((tool) => tool.id === activeToolId);

            return (
              <button
                key={category}
                onClick={() => handleCategoryClick(category)}
                title={t(`categories.${category}`)}
                className={cn(
                  'relative rounded-lg p-2.5 transition-all duration-150 hover:bg-sidebar-accent active:scale-90',
                  isActive
                    ? 'text-primary bg-sidebar-accent'
                    : hasActiveTool
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <CategoryIcon className="h-[18px] w-[18px]" />
                {/* 活动指示条 */}
                {(isActive || hasActiveTool) && (
                  <span
                    className={cn(
                      'absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all',
                      isActive ? 'opacity-100' : 'opacity-50'
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* 版本号 */}
        <div className="mt-2 font-mono text-[9px] text-muted-foreground/40">
          v{__APP_VERSION__}
        </div>
      </nav>

      {/* ===== 工具列表面板 ===== */}
      <div
        className={cn(
          'flex h-full flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200 ease-in-out',
          activeCategory ? 'w-[196px] opacity-100' : 'w-0 overflow-hidden border-r-0 opacity-0'
        )}
      >
        {activeCategory && (
          <div className="flex h-full flex-col animate-fade-in">
            {/* 分类标题 */}
            <div className="flex items-center gap-2 px-3.5 pb-2 pt-3.5">
              {(() => {
                const CategoryIcon = CATEGORY_ICONS[activeCategory];
                return CategoryIcon ? (
                  <CategoryIcon className="h-4 w-4 text-primary" />
                ) : null;
              })()}
              <h2 className="flex-1 truncate text-[13px] font-semibold text-foreground">
                {t(`categories.${activeCategory}`)}
              </h2>
              <span className="rounded-full bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {categoryTools.length}
              </span>
            </div>

            {/* 工具列表 */}
            <div className="flex-1 overflow-y-auto px-2 pb-3" role="list">
              <div className="space-y-px">
                {categoryTools.map((tool) => (
                  <ToolItem
                    key={tool.id}
                    active={activeToolId === tool.id}
                    icon={tool.icon}
                    label={t(`tools.${tool.id}`, tool.name)}
                    running={activeTools.includes(tool.id)}
                    alwaysOn={alwaysOnTools.includes(tool.id)}
                    onClick={() => handleSelectTool(tool.id)}
                  />
                ))}
              </div>
            </div>

            {/* 最近使用（底部） */}
            {recentToolList.length > 0 && (
              <div className="border-t border-sidebar-border px-2 py-2">
                <div className="mb-1 flex items-center gap-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {t('app.recentTools')}
                </div>
                <div className="space-y-px">
                  {recentToolList.slice(0, 3).map((tool) => {
                    if (!tool) return null;
                    return (
                      <ToolItem
                        key={tool.id}
                        active={activeToolId === tool.id}
                        icon={tool.icon}
                        label={t(`tools.${tool.id}`, tool.name)}
                        running={activeTools.includes(tool.id)}
                        alwaysOn={alwaysOnTools.includes(tool.id)}
                        onClick={() => handleSelectTool(tool.id)}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
