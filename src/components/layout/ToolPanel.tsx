import { Suspense, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getAllTools, getToolById } from '@/registry/tool-registry';
import { getRecentToolIds, useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { LogPanel } from '@/components/layout/LogPanel';
import { LocalizedToolErrorBoundary } from '@/components/shared/ToolErrorBoundary';
import { EmptyState } from '@/components/shared/EmptyState';
import { ToolCapabilityNotice } from '@/components/shared/ToolCapabilityNotice';
import { openTool } from '@/lib/tool-navigation';
import { ArrowUpRight, Languages, LayoutDashboard, Loader2, Monitor, Moon, Pin, Power, Search, Settings, Sun } from 'lucide-react';
import { markPerformance, measurePerformance } from '@/lib/performance-diagnostics';
import { AtmosphereLayer } from '@/components/layout/SkinAtmosphere';
import { WindowControls } from '@/components/layout/AppTitleBar';
import { Mascot } from '@/components/mascot/Mascot';

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

function ToolLoadTelemetry({ toolId }: { toolId: string }) {
  useEffect(() => {
    measurePerformance('工具首次挂载', `tool:${toolId}:selected`, { toolId });
  }, [toolId]);
  return null;
}

function WelcomeScreen({ onSelectTool }: { onSelectTool: (id: string) => void }) {
  const { t } = useTranslation();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const pinnedTools = useAppStore((s) => s.pinnedTools);
  const recentToolUsage = useAppStore((s) => s.recentToolUsage);
  const mascotEnabled = useAppStore((s) => s.mascotEnabled) !== false;
  const allTools = useMemo(() => getAllTools(), []);

  const recentTools = useMemo(
    () => getRecentToolIds(recentToolUsage, 6).map((id) => allTools.find((tool) => tool.id === id)).filter(Boolean),
    [allTools, recentToolUsage]
  );

  const pinnedToolDefs = useMemo(
    () => pinnedTools.map((id) => allTools.find((tool) => tool.id === id)).filter(Boolean),
    [allTools, pinnedTools]
  );

  return (
    <div className="app-workbench relative h-full overflow-hidden">
      <div
        data-welcome-grid=""
        className={cn(
          'grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)]',
          mascotEnabled
            ? 'mx-auto max-w-6xl lg:mx-0 lg:max-w-none lg:grid-cols-[minmax(0,54.5rem)_minmax(15.5rem,1fr)] lg:gap-x-8 xl:grid-cols-[minmax(0,52rem)_minmax(18rem,1fr)]'
            : 'mx-auto max-w-6xl',
        )}
      >
        <div className="min-h-0 min-w-0 overflow-y-auto px-5 py-6 xl:px-8 xl:py-8">
          <section className="border-b border-border pb-6">
            <h1 className="max-w-2xl font-heading text-3xl font-semibold tracking-[-0.03em] text-foreground sm:text-4xl">
              {t('app.welcome')}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{t('app.welcomeDesc')}</p>
            <button
              onClick={() => setSearchOpen(true)}
              className="group mt-5 flex min-h-11 w-full max-w-xl cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3.5 text-left shadow-tinted-sm transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/12 text-primary"><Search className="h-4 w-4" /></span>
              <span className="flex-1 text-sm text-muted-foreground">{t('app.searchHint', { count: allTools.length })}</span>
              <kbd className="kbd">Ctrl K</kbd>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </button>
          </section>

          {pinnedToolDefs.length > 0 && (
            <section className="pt-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-heading text-lg font-semibold tracking-tight">{t('app.pinnedBar')}</h2>
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
              <h2 className="font-heading text-lg font-semibold tracking-tight">{t('app.recentTools')}</h2>
            </div>
            {recentTools.length === 0 ? (
              <EmptyState title={t('app.recentToolsEmpty')} className="rounded-lg border border-dashed border-border" />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recentTools.map((tool) => {
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
            )}
          </section>
        </div>
        {mascotEnabled && (
          <aside className="relative hidden h-full min-h-0 lg:block" aria-label={t('theme.mascot')}>
            <Mascot className="absolute inset-y-6 right-5 left-0 xl:inset-y-8 xl:right-8" />
          </aside>
        )}
      </div>
    </div>
  );
}

function ToolStoppedScreen({ toolId }: { toolId: string }) {
  const { t } = useTranslation();
  const toolDef = getToolById(toolId);
  if (!toolDef) return null;
  const Icon = toolDef.icon;

  return (
    <div className="app-workbench relative flex h-full items-center justify-center p-6">
      <div className="max-w-sm border border-border bg-card p-7 text-center shadow-tinted-sm">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
        <h2 className="mt-5 font-heading text-xl font-semibold">{t(`tools.${toolDef.id}`, toolDef.name)}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('app.toolStoppedDesc')}</p>
        <Button className="mt-6" onClick={() => openTool(toolId)}><Power className="h-4 w-4" />{t('app.startTool')}</Button>
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
    if (!isActive) {
      openTool(toolId);
      return;
    }
    toggleTool(toolId);
    const remaining = useToolLifecycleStore.getState().activeTools;
    setActiveTool(remaining.length > 0 ? remaining[remaining.length - 1] : null);
  };

  const label = isAlwaysOn ? t('app.toolAlwaysOn') : isActive ? t('app.stopTool') : t('app.startTool');
  return (
    <button onClick={handleToggle} disabled={isAlwaysOn} aria-label={label} className={cn('flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition-colors disabled:cursor-default', isAlwaysOn ? 'border-warning/35 bg-warning/10 text-warning' : isActive ? 'border-success/35 bg-success/10 text-success hover:border-destructive/45 hover:bg-destructive/10 hover:text-destructive' : 'border-border bg-muted text-muted-foreground hover:border-success/40 hover:text-success')}>
      {isAlwaysOn ? <Pin className="h-3 w-3" /> : <Power className="h-3 w-3" />}
      {isAlwaysOn ? t('app.alwaysOn') : isActive ? t('app.toolRunning') : t('app.toolStopped')}
    </button>
  );
}

export function ToolPanel({ toolId, onOpenSettings }: ToolPanelProps) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const pinnedTools = useAppStore((s) => s.pinnedTools);
  const activeTools = useToolLifecycleStore((s) => s.activeTools);
  const pinnedToolDefs = useMemo(
    () => pinnedTools.map((id) => getToolById(id)).filter((tool): tool is NonNullable<ReturnType<typeof getToolById>> => Boolean(tool)),
    [pinnedTools]
  );
  const tool = toolId ? getToolById(toolId) : null;
  const isChinese = (i18n.resolvedLanguage ?? i18n.language).startsWith('zh');
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  useEffect(() => {
    if (toolId) markPerformance(`tool:${toolId}:selected`);
  }, [toolId]);

  const handleSelectTool = (id: string) => {
    openTool(id);
  };

  const cycleTheme = () => {
    const themes = ['light', 'dark', 'system'] as const;
    setTheme(themes[(themes.indexOf(theme) + 1) % themes.length]);
  };

  return (
    <div className="app-panel flex h-full min-h-0 min-w-0 flex-col bg-background">
      <AtmosphereLayer />
      <a href="#workspace-main" className="skip-link">{t('app.skipToMain')}</a>
      <header className="relative z-[1] flex h-12 shrink-0 items-center gap-3 border-b border-border/50 bg-transparent pl-3 sm:pl-4">
        <div className="flex min-w-0 items-center gap-2.5">
          {tool ? (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <tool.icon className="h-4 w-4" />
            </span>
          ) : (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <LayoutDashboard className="h-4 w-4" />
            </span>
          )}
          <h1 className="truncate font-heading text-[15px] font-semibold tracking-tight text-foreground">
            {tool ? t(`tools.${tool.id}`, tool.name) : t('app.workspace')}
          </h1>
          {tool && <ToolCapabilityNotice tool={tool} compact />}
        </div>
        <div className="h-full min-w-6 flex-1" data-tauri-drag-region onDoubleClick={(event) => event.preventDefault()} />
        <div className="ml-auto flex shrink-0 items-center gap-1 pr-1">
          {tool && pinnedToolDefs.length > 0 && (
            <div className="hidden items-center gap-0.5 md:flex" aria-label={t('app.pinnedBar')}>
              {pinnedToolDefs.slice(0, 6).map((item) => {
                const Icon = item.icon;
                const active = toolId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectTool(item.id)}
                    title={t(`tools.${item.id}`, item.name)}
                    aria-label={t(`tools.${item.id}`, item.name)}
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
                      active ? 'bg-primary/12 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          )}
          {tool && <ToolPowerSwitch toolId={tool.id} />}
          <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSearchOpen(true)} aria-label={t('app.searchTools')} title="Ctrl+K"><Search /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => i18n.changeLanguage(isChinese ? 'en' : 'zh')} aria-label={isChinese ? '切换为英语' : 'Switch to Chinese'} title={isChinese ? 'English' : '中文'}><Languages /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={cycleTheme} aria-label={t(`theme.${theme}`)} title={t(`theme.${theme}`)}><ThemeIcon /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onOpenSettings} aria-label={t('app.settings')} title={t('app.settings')}><Settings /></Button>
          <WindowControls />
        </div>
      </header>

      <main id="workspace-main" className="min-h-0 flex-1 overflow-hidden" tabIndex={-1}>
        {tool && activeTools.includes(tool.id) ? activeTools.map((id) => {
          const definition = getToolById(id);
          if (!definition) return null;
          return <div key={id} className={id === toolId ? 'h-full animate-tool-enter' : 'hidden'} aria-hidden={id !== toolId}>
            <LocalizedToolErrorBoundary toolId={definition.id} toolName={t(`tools.${definition.id}`, definition.name)}>
              <Suspense fallback={<ToolLoader />}><ToolLoadTelemetry toolId={definition.id} /><definition.component /></Suspense>
            </LocalizedToolErrorBoundary>
          </div>;
        }) : tool ? <ToolStoppedScreen toolId={tool.id} /> : <WelcomeScreen onSelectTool={handleSelectTool} />}
      </main>

      <LogPanel />
    </div>
  );
}
