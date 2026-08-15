import { Suspense, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getAllTools, getAvailableCategories, getToolById, getToolsByCategory } from '@/registry/tool-registry';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { LogPanel } from '@/components/layout/LogPanel';
import { useLogStore } from '@/store/log-store';
import { Activity, ArrowUpRight, Command, Languages, LayoutDashboard, Loader2, Monitor, Moon, Pin, Power, Search, Settings, ShieldCheck, Sun } from 'lucide-react';

interface ToolPanelProps {
  toolId: string | null;
  onOpenSettings: () => void;
}

function ToolLoader() {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        正在载入工具
      </div>
    </div>
  );
}

function WelcomeScreen({ onSelectTool }: { onSelectTool: (id: string) => void }) {
  const { t } = useTranslation();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const pinnedTools = useAppStore((s) => s.pinnedTools);
  const allTools = useMemo(() => getAllTools(), []);
  const categories = useMemo(() => getAvailableCategories(), []);

  const quickTools = useMemo(() => {
    const defaults = ['json-formatter', 'base64', 'timestamp', 'uuid-generator', 'text-diff', 'qrcode'];
    return defaults.map((id) => allTools.find((tool) => tool.id === id)).filter(Boolean);
  }, [allTools]);

  const pinnedToolDefs = useMemo(
    () => pinnedTools.map((id) => allTools.find((tool) => tool.id === id)).filter(Boolean),
    [allTools, pinnedTools]
  );

  return (
    <div className="app-workbench h-full overflow-y-auto">
      <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-8 xl:grid-cols-[minmax(0,1fr)_260px] xl:px-10 xl:py-10">
        <div>
          <section className="border-b border-border pb-8">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" />
              {t('app.localFirstWorkspace')}
            </div>
            <h1 className="mt-4 max-w-2xl font-heading text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl">
              {t('app.welcome')}
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-7 text-muted-foreground">{t('app.welcomeDesc')}</p>
            <button
              onClick={() => setSearchOpen(true)}
              className="group mt-7 flex min-h-12 w-full max-w-xl items-center gap-3 rounded-xl border border-border bg-card px-4 text-left shadow-tinted-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Search className="h-4 w-4" /></span>
              <span className="flex-1 text-sm text-muted-foreground">{t('app.searchHint', { count: allTools.length })}</span>
              <kbd className="kbd">Ctrl K</kbd>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          </section>

          {pinnedToolDefs.length > 0 && (
            <section className="pt-8">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('app.pinnedBar')}</p>
                  <h2 className="mt-1 font-heading text-xl font-semibold tracking-tight">{t('app.startNow')}</h2>
                </div>
                <Pin className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {pinnedToolDefs.map((tool) => {
                  if (!tool) return null;
                  const Icon = tool.icon;
                  return (
                    <button key={tool.id} onClick={() => onSelectTool(tool.id)} className="tool-card group text-left">
                      <span className="tool-card-icon"><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold leading-snug text-foreground">{t(`tools.${tool.id}`, tool.name)}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">{tool.description}</span>
                      </span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="pt-8">
            <div className="mb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t('app.quickTools')}</p>
              <h2 className="mt-1 font-heading text-xl font-semibold tracking-tight">常用工具</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {quickTools.map((tool) => {
                if (!tool) return null;
                const Icon = tool.icon;
                return (
                  <button key={tool.id} onClick={() => onSelectTool(tool.id)} className="tool-card group text-left">
                    <span className="tool-card-icon"><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold leading-snug text-foreground">{t(`tools.${tool.id}`, tool.name)}</span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">{tool.description}</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary" />
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="self-start border border-border bg-card p-5 xl:sticky xl:top-0" aria-label="工具概览">
          <div className="flex items-center gap-2 text-primary"><Activity className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-[0.16em]">{t('app.workspaceOverview')}</span></div>
          <div className="mt-5 border-y border-border py-5">
            <p className="font-heading text-4xl font-semibold tracking-tight text-foreground">{allTools.length}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('app.offlineTools')}</p>
          </div>
          <div className="mt-5 space-y-1">
            {categories.map((category) => (
              <button key={category} onClick={() => setActiveCategory(category)} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <span>{t(`categories.${category}`)}</span>
                <span className="font-mono text-[11px] text-primary">{getToolsByCategory(category).length}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden="true" /> {t('app.localProcessing')}</div>
        </aside>
      </div>
    </div>
  );
}

function ToolStoppedScreen({ toolId }: { toolId: string }) {
  const { t } = useTranslation();
  const startTool = useToolLifecycleStore((s) => s.startTool);
  const toolDef = getToolById(toolId);
  if (!toolDef) return null;
  const Icon = toolDef.icon;

  return (
    <div className="app-workbench flex h-full items-center justify-center p-6">
      <div className="max-w-sm border border-border bg-card p-7 text-center shadow-tinted-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
        <h2 className="mt-5 font-heading text-xl font-semibold">{t(`tools.${toolDef.id}`, toolDef.name)}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('app.toolStoppedDesc')}</p>
        <Button className="mt-6" onClick={() => startTool(toolId)}><Power className="h-4 w-4" />{t('app.startTool')}</Button>
      </div>
    </div>
  );
}

function ToolPowerSwitch({ toolId }: { toolId: string }) {
  const { t } = useTranslation();
  const activeTools = useToolLifecycleStore((s) => s.activeTools);
  const alwaysOnTools = useToolLifecycleStore((s) => s.alwaysOnTools);
  const toggleTool = useToolLifecycleStore((s) => s.toggleTool);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const isActive = activeTools.includes(toolId);
  const isAlwaysOn = alwaysOnTools.includes(toolId);

  const handleToggle = () => {
    if (isAlwaysOn) return;
    toggleTool(toolId);
    if (isActive) {
      const remaining = useToolLifecycleStore.getState().activeTools;
      setActiveTool(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    }
  };

  const label = isAlwaysOn ? t('app.toolAlwaysOn') : isActive ? t('app.stopTool') : t('app.startTool');
  return (
    <button onClick={handleToggle} disabled={isAlwaysOn} aria-label={label} className={cn('flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-default', isAlwaysOn ? 'border-warning/35 bg-warning/10 text-warning' : isActive ? 'border-success/35 bg-success/10 text-success hover:border-destructive/45 hover:bg-destructive/10 hover:text-destructive' : 'border-border bg-muted text-muted-foreground hover:border-success/40 hover:text-success')}>
      {isAlwaysOn ? <Pin className="h-3 w-3" /> : <Power className="h-3 w-3" />}
      {isAlwaysOn ? t('app.alwaysOn') : isActive ? t('app.toolRunning') : t('app.toolStopped')}
    </button>
  );
}

function UnreadLogBadge() {
  const unreadCount = useLogStore((s) => s.unreadCount);
  return unreadCount > 0 ? <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-primary">{unreadCount > 99 ? '99+' : unreadCount}</span> : null;
}

export function ToolPanel({ toolId, onOpenSettings }: ToolPanelProps) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const activeTools = useToolLifecycleStore((s) => s.activeTools);
  const startTool = useToolLifecycleStore((s) => s.startTool);
  const tool = toolId ? getToolById(toolId) : null;
  const isChinese = (i18n.resolvedLanguage ?? i18n.language).startsWith('zh');
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  const handleSelectTool = (id: string) => {
    startTool(id);
    setActiveTool(id);
  };

  const cycleTheme = () => {
    const themes = ['light', 'dark', 'system'] as const;
    setTheme(themes[(themes.indexOf(theme) + 1) % themes.length]);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <a href="#workspace-main" className="skip-link">{t('app.skipToMain')}</a>
      <header className="flex min-h-[68px] shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {tool ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><tool.icon className="h-4 w-4" /></span> : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground"><LayoutDashboard className="h-4 w-4" /></span>}
          <div className="min-w-0">
            <p className="hidden text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:block">{tool ? t(`categories.${tool.category}`) : 'Niuery Toolkit'}</p>
            <h1 className="truncate font-heading text-lg font-semibold tracking-tight text-foreground">{tool ? t(`tools.${tool.id}`, tool.name) : t('app.workspace')}</h1>
          </div>
          {tool && <ToolPowerSwitch toolId={tool.id} />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSearchOpen(true)} aria-label={t('app.searchTools')} title="Ctrl+K"><Search /></Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => i18n.changeLanguage(isChinese ? 'en' : 'zh')} aria-label={isChinese ? '切换为英语' : 'Switch to Chinese'} title={isChinese ? 'English' : '中文'}><Languages /></Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={cycleTheme} aria-label={t(`theme.${theme}`)} title={t(`theme.${theme}`)}><ThemeIcon /></Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onOpenSettings} aria-label={t('app.settings')} title={t('app.settings')}><Settings /></Button>
        </div>
      </header>

      <main id="workspace-main" className="min-h-0 flex-1 overflow-hidden" tabIndex={-1}>
        {tool && activeTools.includes(tool.id) ? activeTools.map((id) => {
          const definition = getToolById(id);
          if (!definition) return null;
          return <div key={id} className={id === toolId ? 'h-full animate-tool-enter' : 'hidden'} aria-hidden={id !== toolId}><Suspense fallback={<ToolLoader />}><definition.component /></Suspense></div>;
        }) : tool ? <ToolStoppedScreen toolId={tool.id} /> : <WelcomeScreen onSelectTool={handleSelectTool} />}
      </main>

      <LogPanel />
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-card px-5 font-mono text-[10px] text-muted-foreground">
        <span className="min-w-0 truncate">{tool ? t(`tools.${tool.id}`, tool.name) : t('app.offlineWorkspace')}</span>
        <div className="flex items-center gap-4">
          <button onClick={() => useLogStore.getState().setPanelOpen(!useLogStore.getState().panelOpen)} className="flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:text-foreground" aria-label={t('app.logs', '日志')}><Command className="h-3 w-3" />{t('app.logs', '日志')}<UnreadLogBadge /></button>
          <span className="hidden sm:inline">UTF-8</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-success" />{t('app.offlineMode')}</span>
        </div>
      </footer>
    </div>
  );
}
