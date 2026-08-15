import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import { getAvailableCategories, getToolsByCategory } from '@/registry/tool-registry';
import { CATEGORY_ICONS } from '@/types/tool';
import { ChevronDown, Home, Pin, Search, ShieldCheck } from 'lucide-react';
import { BrandMark } from '@/components/shared/BrandMark';

interface SidebarProps {
  onSelectTool: (toolId: string) => void;
}

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
      title={label}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors duration-150',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary-foreground' : 'text-muted-foreground group-hover:text-primary')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {alwaysOn ? (
        <Pin className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-primary-foreground/85' : 'text-warning')} aria-label="常驻工具" />
      ) : running ? (
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', active ? 'bg-primary-foreground' : 'bg-success')} aria-label="正在运行" />
      ) : null}
    </button>
  );
}

export function Sidebar({ onSelectTool }: SidebarProps) {
  const { t } = useTranslation();
  const { activeToolId, setSearchOpen, setActiveTool, activeCategory, setActiveCategory } = useAppStore();
  const activeTools = useToolLifecycleStore((s) => s.activeTools);
  const alwaysOnTools = useToolLifecycleStore((s) => s.alwaysOnTools);
  const categories = getAvailableCategories();

  const categoryTools = useMemo(
    () => (activeCategory ? getToolsByCategory(activeCategory) : []),
    [activeCategory]
  );

  const handleHome = () => {
    setActiveTool(null);
    setActiveCategory(null);
  };

  return (
    <aside className="app-sidebar flex h-full w-[clamp(13.5rem,18vw,17rem)] shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-3" aria-label="工具导航">
      <div className="flex items-center gap-3 px-2 py-2">
        <button onClick={handleHome} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('app.home', '首页')}>
          <BrandMark size={34} className="brand-mark" />
        </button>
        <div className="min-w-0">
          <p className="font-heading text-[15px] font-semibold leading-none tracking-tight text-sidebar-foreground">Niuery Toolkit</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground">{t('app.offlineWorkspace')}</p>
        </div>
      </div>

      <button
        onClick={() => setSearchOpen(true)}
        className="mt-4 flex h-10 w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-background/60 px-3 text-left text-[13px] text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="h-4 w-4 text-primary" />
        <span className="flex-1">{t('app.searchTools')}</span>
        <kbd className="kbd">Ctrl K</kbd>
      </button>

      <nav className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1" aria-label="工具分类">
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{t('app.workspace')}</p>
        <button
          onClick={handleHome}
          aria-current={!activeToolId && !activeCategory ? 'page' : undefined}
          className={cn(
            'mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            !activeToolId && !activeCategory ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground'
          )}
        >
          <Home className={cn('h-4 w-4', !activeToolId && !activeCategory ? 'text-primary' : 'text-muted-foreground')} />
          {t('app.home', '首页')}
        </button>

        <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{t('app.allCategories')}</p>
        <div className="space-y-1">
          {categories.map((category) => {
            const CategoryIcon = CATEGORY_ICONS[category] || Search;
            const isOpen = activeCategory === category;
            const hasActiveTool = activeToolId != null && getToolsByCategory(category).some((tool) => tool.id === activeToolId);
            const tools = isOpen ? categoryTools : [];
            return (
              <div key={category}>
                <button
                  onClick={() => setActiveCategory(isOpen ? null : category)}
                  aria-expanded={isOpen}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isOpen ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                  )}
                >
                  <CategoryIcon className={cn('h-4 w-4', isOpen || hasActiveTool ? 'text-primary' : 'text-muted-foreground')} />
                  <span className="flex-1">{t(`categories.${category}`)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{getToolsByCategory(category).length}</span>
                  <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-150', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="space-y-0.5 border-l border-sidebar-border py-1 pl-3" role="list">
                    {tools.map((tool) => (
                      <ToolItem
                        key={tool.id}
                        active={activeToolId === tool.id}
                        icon={tool.icon}
                        label={t(`tools.${tool.id}`, tool.name)}
                        running={activeTools.includes(tool.id)}
                        alwaysOn={alwaysOnTools.includes(tool.id)}
                        onClick={() => onSelectTool(tool.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      <div className="mt-3 flex items-center justify-between border-t border-sidebar-border px-2 pt-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" />{t('app.offlineMode')}</span>
        <span className="font-mono">v{__APP_VERSION__}</span>
      </div>
    </aside>
  );
}
