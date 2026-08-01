import { Suspense, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import {
  getAllTools,
  getAvailableCategories,
  getToolById,
  getToolsByCategory,
} from '@/registry/tool-registry';
import { useAppStore } from '@/store/app-store';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { BrandMark } from '@/components/shared/BrandMark';
import { Search, Moon, Sun, Monitor, Loader2, Languages, Sparkles } from 'lucide-react';

interface ToolPanelProps {
  toolId: string | null;
}

function ToolLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <span className="text-xs text-muted-foreground">加载中…</span>
      </div>
    </div>
  );
}

/** 无工具被选中时的「工作台」开场 —— 非常规居中 hero，而是左对齐的命令中心 */
function WelcomeScreen({ onSelectTool }: { onSelectTool: (id: string) => void }) {
  const { t } = useTranslation();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setActiveCategory = useAppStore((s) => s.setActiveCategory);
  const recentTools = useAppStore((s) => s.recentTools);

  const allTools = useMemo(() => getAllTools(), []);
  const categories = useMemo(() => getAvailableCategories(), []);

  // 快速访问：优先最近使用，否则展示一组常用工具
  const quickTools = useMemo(() => {
    const POPULAR = [
      'json-formatter',
      'base64',
      'timestamp',
      'uuid-generator',
      'text-diff',
      'qrcode',
      'regex-tester',
      'api-tester',
    ];
    const recent = recentTools
      .map((id) => allTools.find((tool) => tool.id === id))
      .filter(Boolean);
    if (recent.length >= 4) return recent.slice(0, 8);
    const ids = new Set(recent.map((tool) => tool!.id));
    const popular = POPULAR.map((id) => allTools.find((tool) => tool.id === id)).filter(
      (tool) => tool && !ids.has(tool.id)
    );
    return [...recent, ...popular].slice(0, 8);
  }, [recentTools, allTools]);

  return (
    <div className="app-ambient h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 pb-16 pt-12">
        {/* 品牌与标语 */}
        <div className="animate-rise-in">
          <BrandMark size={46} />
          <h1 className="mt-5 font-heading text-[32px] font-bold leading-tight tracking-tight text-foreground">
            {t('app.welcome')}
          </h1>
          <p className="mt-2.5 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t('app.welcomeDesc')}
          </p>

          {/* 搜索触发器 */}
          <button
            onClick={() => setSearchOpen(true)}
            className={cn(
              'group mt-6 flex w-full max-w-md items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left',
              'shadow-tinted-sm transition-all duration-200',
              'hover:border-primary/40 hover:shadow-tinted active:scale-[0.99]'
            )}
          >
            <Search className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            <span className="flex-1 text-sm text-muted-foreground">
              {t('app.searchHint', { count: allTools.length })}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="kbd">Ctrl</kbd>
              <kbd className="kbd">K</kbd>
            </span>
          </button>
        </div>

        {/* 快速访问网格 */}
        <section className="mt-11">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {t('app.quickTools')}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
            {quickTools.map((tool, i) => {
              if (!tool) return null;
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  onClick={() => onSelectTool(tool.id)}
                  className="animate-rise-in group panel-raised flex flex-col gap-2.5 p-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-tinted active:translate-y-0 active:scale-[0.98]"
                  style={{ animationDelay: `${60 + i * 45}ms` }}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/70 transition-colors duration-200 group-hover:bg-primary/15">
                    <Icon className="h-4 w-4 text-muted-foreground transition-colors duration-200 group-hover:text-primary" />
                  </span>
                  <span className="text-[13px] font-medium leading-snug text-foreground">
                    {t(`tools.${tool.id}`, tool.name)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* 分类快捷入口 */}
        <section className="mt-9">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t('app.allCategories')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {categories.map((category, i) => {
              const tools = getToolsByCategory(category);
              const count = tools.length;
              return (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className="animate-rise-in group flex items-center gap-2 rounded-full border border-border bg-card/60 px-3.5 py-1.5 text-[13px] text-muted-foreground transition-all duration-200 hover:border-primary/40 hover:bg-accent/50 hover:text-foreground active:scale-95"
                  style={{ animationDelay: `${300 + i * 40}ms` }}
                >
                  <span className="font-medium">{t(`categories.${category}`)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/60 transition-colors group-hover:text-primary">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

export function ToolPanel({ toolId }: ToolPanelProps) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const setActiveTool = useAppStore((s) => s.setActiveTool);
  const addRecentTool = useAppStore((s) => s.addRecentTool);
  const tool = toolId ? getToolById(toolId) : null;
  // KeepAlive: 记录已访问过的工具，保持其组件挂载不丢失状态
  const visitedToolsRef = useRef<Set<string>>(new Set());
  if (toolId) visitedToolsRef.current.add(toolId);
  const visitedTools = Array.from(visitedToolsRef.current);

  const handleSelectTool = (id: string) => {
    setActiveTool(id);
    addRecentTool(id);
  };

  const cycleTheme = () => {
    const themes = ['light', 'dark', 'system'] as const;
    const currentIndex = themes.indexOf(theme);
    setTheme(themes[(currentIndex + 1) % themes.length]);
  };

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  const toggleLanguage = () => {
    const newLang = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(newLang);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部栏 */}
      <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-border/80 bg-background/70 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2.5">
          {tool ? (
            <>
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/70">
                <tool.icon className="h-3.5 w-3.5 text-primary" />
              </span>
              <h1 className="truncate font-heading text-[15px] font-semibold tracking-tight text-foreground">
                {t(`tools.${tool.id}`, tool.name)}
              </h1>
              <span className="shrink-0 rounded-full border border-border/70 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t(`categories.${tool.category}`)}
              </span>
            </>
          ) : (
            <span className="text-[13px] text-muted-foreground">{t('app.noToolSelected')}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => setSearchOpen(true)}
            title="Ctrl+K"
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={toggleLanguage}
            title={i18n.language === 'zh' ? 'English' : '中文'}
          >
            <Languages className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={cycleTheme}
            title={t(`theme.${theme}`)}
          >
            <ThemeIcon className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* 内容区 */}
      <main className="flex-1 overflow-hidden">
        {tool ? (
          visitedTools.map((id) => {
            const visited = getToolById(id);
            if (!visited) return null;
            const isActive = id === toolId;
            return (
              <div
                key={id}
                className={isActive ? 'h-full animate-tool-enter' : 'hidden'}
                aria-hidden={!isActive}
              >
                <Suspense fallback={<ToolLoader />}>
                  <visited.component />
                </Suspense>
              </div>
            );
          })
        ) : (
          <WelcomeScreen onSelectTool={handleSelectTool} />
        )}
      </main>

      {/* 状态栏 */}
      <footer className="flex h-[26px] shrink-0 items-center justify-between border-t border-border/80 bg-background/70 px-3 font-mono text-[10.5px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-3">
          {tool && <span className="truncate">{t(`tools.${tool.id}`, tool.name)}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span>UTF-8</span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-glow-pulse" />
            {t('app.offlineMode')}
          </span>
        </div>
      </footer>
    </div>
  );
}
