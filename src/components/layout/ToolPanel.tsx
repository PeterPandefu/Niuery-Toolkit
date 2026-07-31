import { Suspense, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getToolById } from '@/registry/tool-registry';
import { useAppStore } from '@/store/app-store';
import { useTheme } from '@/hooks/use-theme';
import { Button } from '@/components/ui/button';
import { Search, Moon, Sun, Monitor, Loader2, Languages } from 'lucide-react';

interface ToolPanelProps {
  toolId: string | null;
}

function ToolLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function WelcomeScreen() {
  const { t } = useTranslation();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="text-6xl">🧰</div>
      <h2 className="text-xl font-semibold">{t('app.welcome')}</h2>
      <p className="max-w-md text-muted-foreground">
        {t('app.welcomeDesc')}
        <br />
        {t('app.selectToolHint')} <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs">Ctrl+K</kbd> {t('app.toSearch')}
      </p>
      <Button variant="outline" onClick={() => setSearchOpen(true)}>
        <Search className="mr-2 h-4 w-4" />
        {t('app.searchTools')}
      </Button>
    </div>
  );
}

export function ToolPanel({ toolId }: ToolPanelProps) {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const tool = toolId ? getToolById(toolId) : null;
  // KeepAlive: 记录已访问过的工具，保持其组件挂载不丢失状态
  const visitedToolsRef = useRef<Set<string>>(new Set());
  if (toolId) visitedToolsRef.current.add(toolId);
  const visitedTools = Array.from(visitedToolsRef.current);

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
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          {tool ? (
            <>
              <tool.icon className="h-4 w-4 text-muted-foreground" />
              <h1 className="font-medium">{t(`tools.${tool.id}`, tool.name)}</h1>
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {t(`categories.${tool.category}`)}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{t('app.noToolSelected')}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setSearchOpen(true)} title="Ctrl+K">
            <Search className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleLanguage} title={i18n.language === 'zh' ? 'English' : '中文'}>
            <Languages className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={cycleTheme} title={t(`theme.${theme}`)}>
            <ThemeIcon className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {tool ? (
          visitedTools.map((id) => {
            const t = getToolById(id);
            if (!t) return null;
            const isActive = id === toolId;
            return (
              <div
                key={id}
                className={isActive ? 'h-full' : 'hidden'}
                aria-hidden={!isActive}
              >
                <Suspense fallback={<ToolLoader />}>
                  <t.component />
                </Suspense>
              </div>
            );
          })
        ) : (
          <WelcomeScreen />
        )}
      </main>

      {/* Status Bar */}
      <footer className="flex h-6 shrink-0 items-center justify-between border-t px-3 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          {tool && <span>{t(`tools.${tool.id}`, tool.name)}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span>UTF-8</span>
          <span>{t('app.offlineMode')}</span>
        </div>
      </footer>
    </div>
  );
}
