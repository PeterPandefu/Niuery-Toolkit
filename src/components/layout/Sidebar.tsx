import { useEffect, useMemo, useRef, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { AtmosphereLayer } from '@/components/layout/SkinAtmosphere';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import { getAvailableCategories, getToolsByCategory, preloadTool } from '@/registry/tool-registry';
import { CATEGORY_ICONS } from '@/types/tool';
import { ChevronDown, Home, Pin, Search } from 'lucide-react';
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
  onPointerEnter,
  onFocus,
  compact,
}: {
  active: boolean;
  icon: ComponentType<{ className?: string }>;
  label: string;
  running?: boolean;
  alwaysOn?: boolean;
  onClick: () => void;
  onPointerEnter?: () => void;
  onFocus?: () => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onFocus={onFocus}
      aria-current={active ? 'page' : undefined}
      title={label}
      className={cn(
        'nav-item group',
        compact && 'px-2',
        active
          ? 'bg-primary/12 text-foreground'
          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
      )}
    >
      <span
        className={cn(
          'absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
          active ? 'opacity-100' : 'opacity-0'
        )}
      />
      <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-primary')} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {alwaysOn ? (
        <Pin className={cn('h-3.5 w-3.5 shrink-0', active ? 'text-primary' : 'text-warning')} aria-label="常驻工具" />
      ) : running ? (
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', active ? 'bg-primary' : 'bg-success')} aria-label="正在运行" />
      ) : null}
    </button>
  );
}

export function Sidebar({ onSelectTool }: SidebarProps) {
  const { t } = useTranslation();
  const { activeToolId, setSearchOpen, setActiveTool, activeCategory, setActiveCategory, sidebarCollapsed, toggleSidebarCollapsed } = useAppStore();
  const activeTools = useToolLifecycleStore((s) => s.activeTools);
  const alwaysOnTools = useToolLifecycleStore((s) => s.alwaysOnTools);
  const categories = getAvailableCategories();
  const flyoutRef = useRef<HTMLDivElement>(null);

  const categoryTools = useMemo(
    () => (activeCategory ? getToolsByCategory(activeCategory) : []),
    [activeCategory]
  );

  const handleHome = () => {
    setActiveTool(null);
    setActiveCategory(null);
  };

  useEffect(() => {
    if (!sidebarCollapsed || !activeCategory) return;
    const onPointerDown = (event: PointerEvent) => {
      if (flyoutRef.current && !flyoutRef.current.contains(event.target as Node)) {
        setActiveCategory(null);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveCategory(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [sidebarCollapsed, activeCategory, setActiveCategory]);

  return (
    <aside
      className={cn(
        'app-sidebar app-sidebar-panel relative z-20 flex h-full shrink-0 flex-col bg-sidebar p-2',
        sidebarCollapsed ? 'is-collapsed overflow-visible' : 'overflow-hidden'
      )}
      aria-label="工具导航"
    >
      <AtmosphereLayer density="narrow" />
      <div className={cn('flex h-10 shrink-0 items-center', sidebarCollapsed ? 'justify-center' : 'gap-2')}>
        <button
          type="button"
          onClick={toggleSidebarCollapsed}
          className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={!sidebarCollapsed}
          aria-label={sidebarCollapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
          title={sidebarCollapsed ? t('app.expandSidebar') : t('app.collapseSidebar')}
        >
          <BrandMark size={28} className="brand-mark" />
        </button>
        {!sidebarCollapsed && (
          <div className="min-w-0 flex-1 overflow-hidden" data-tauri-drag-region>
            <p className="truncate font-heading text-[13px] font-semibold leading-5 tracking-tight text-sidebar-foreground">Niuery Toolkit</p>
            <p className="truncate text-[11px] leading-4 text-muted-foreground">{t('app.offlineWorkspace')}</p>
          </div>
        )}
      </div>

      <button
        onClick={() => setSearchOpen(true)}
        title={t('app.searchTools')}
        aria-label={t('app.searchTools')}
        className={cn(
          'mt-3 flex h-9 w-full items-center rounded-lg border border-sidebar-border bg-background/70 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          sidebarCollapsed ? 'justify-center px-0' : 'gap-2.5 px-2.5 text-left text-[13px]'
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-primary" />
        {!sidebarCollapsed && (
          <>
            <span className="min-w-0 flex-1 truncate">{t('app.searchTools')}</span>
            <kbd className="kbd shrink-0">Ctrl K</kbd>
          </>
        )}
      </button>

      <nav className="mt-4 min-h-0 flex-1 overflow-y-auto pr-0.5" aria-label="Category navigation">
        {!sidebarCollapsed && (
          <p className="px-2.5 pb-1.5 text-[11px] font-medium text-muted-foreground">{t('app.workspace')}</p>
        )}
        <button
          onClick={handleHome}
          aria-current={!activeToolId && !activeCategory ? 'page' : undefined}
          title={t('app.home', '首页')}
          className={cn(
            'nav-item mb-1 font-medium',
            sidebarCollapsed && 'justify-center px-0',
            !activeToolId && !activeCategory ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground'
          )}
        >
          <Home className={cn('h-4 w-4 shrink-0', !activeToolId && !activeCategory ? 'text-primary' : 'text-muted-foreground')} />
          {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate">{t('app.home')}</span>}
        </button>

        {!sidebarCollapsed && (
          <p className="px-2.5 pb-1.5 pt-3 text-[11px] font-medium text-muted-foreground">{t('app.allCategories')}</p>
        )}
        <div className="space-y-0.5">
          {categories.map((category) => {
            const CategoryIcon = CATEGORY_ICONS[category] || Search;
            const isOpen = activeCategory === category;
            const hasActiveTool = activeToolId != null && getToolsByCategory(category).some((tool) => tool.id === activeToolId);
            const tools = isOpen ? categoryTools : [];
            const label = t(`categories.${category}`);
            return (
              <div key={category} className="relative" ref={isOpen && sidebarCollapsed ? flyoutRef : undefined}>
                <button
                  onClick={() => setActiveCategory(isOpen ? null : category)}
                  aria-expanded={isOpen}
                  title={label}
                  className={cn(
                    'nav-item',
                    sidebarCollapsed && 'justify-center px-0',
                    isOpen || hasActiveTool ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                  )}
                >
                  <CategoryIcon className={cn('h-4 w-4 shrink-0', isOpen || hasActiveTool ? 'text-primary' : 'text-muted-foreground')} />
                  {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate">{label}</span>}
                  {!sidebarCollapsed && <span className="font-mono text-[10px] text-muted-foreground">{getToolsByCategory(category).length}</span>}
                  {!sidebarCollapsed && <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150', isOpen && 'rotate-180')} />}
                </button>
                {isOpen && !sidebarCollapsed && (
                  <div className="space-y-0.5 border-l border-sidebar-border py-1 pl-2.5" role="list">
                    {tools.map((tool) => (
                      <ToolItem
                        key={tool.id}
                        active={activeToolId === tool.id}
                        icon={tool.icon}
                        label={t(`tools.${tool.id}`, tool.name)}
                        running={activeTools.includes(tool.id)}
                        alwaysOn={alwaysOnTools.includes(tool.id)}
                        onClick={() => onSelectTool(tool.id)}
                        onPointerEnter={() => preloadTool(tool.id)}
                        onFocus={() => preloadTool(tool.id)}
                      />
                    ))}
                  </div>
                )}
                {isOpen && sidebarCollapsed && (
                  <div className="absolute left-full top-0 z-40 ml-2 max-h-[min(24rem,calc(100vh-6rem))] w-56 overflow-y-auto rounded-lg border border-border bg-popover p-2 shadow-tinted-lg" role="list">
                    <p className="px-2 pb-1.5 text-[11px] font-medium text-muted-foreground">{label}</p>
                    {tools.map((tool) => (
                      <ToolItem
                        key={tool.id}
                        compact
                        active={activeToolId === tool.id}
                        icon={tool.icon}
                        label={t(`tools.${tool.id}`, tool.name)}
                        running={activeTools.includes(tool.id)}
                        alwaysOn={alwaysOnTools.includes(tool.id)}
                        onClick={() => onSelectTool(tool.id)}
                        onPointerEnter={() => preloadTool(tool.id)}
                        onFocus={() => preloadTool(tool.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
