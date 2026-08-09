import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { getAvailableCategories, getToolsByCategory } from '@/registry/tool-registry';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';
import { useAppStore } from '@/store/app-store';
import { isTauri } from '@/lib/api-client';
import { emitHotkeysChanged } from '@/lib/hotkeys';
import { CATEGORY_ICONS } from '@/types/tool';
import { Check, Monitor, Moon, Palette, Pin, Power, RotateCcw, Search, Sun, X, Zap, Keyboard } from 'lucide-react';
import { getThemeTokens, SKIN_IDS } from '@/lib/theme';
import { useTheme } from '@/hooks/use-theme';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 开关组件 */
function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-all duration-200',
        disabled
          ? 'cursor-not-allowed bg-muted/60'
          : checked
          ? 'bg-success shadow-tinted-sm'
            : 'bg-muted-foreground/25 hover:bg-muted-foreground/35'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked && 'translate-x-4'
        )}
      />
    </button>
  );
}

/** 快捷键动作定义 */
const HOTKEY_ACTIONS = [
  { id: 'showWindow', labelKey: 'hotkeys.showWindow', descKey: 'hotkeys.showWindowDesc' },
  { id: 'screenshot', labelKey: 'hotkeys.screenshot', descKey: 'hotkeys.screenshotDesc' },
  { id: 'longshot', labelKey: 'hotkeys.longshot', descKey: 'hotkeys.longshotDesc' },
  { id: 'screenRecorder', labelKey: 'hotkeys.screenRecorder', descKey: 'hotkeys.screenRecorderDesc' },
] as const;

/** 解析快捷键字符串为显示用的 parts */
function parseShortcutDisplay(shortcut: string): string[] {
  return shortcut.split('+').map((s) => s.trim());
}

/** 快捷键录制组件 */
function HotkeyRecorder({
  value,
  onChange,
  actionId,
}: {
  value: string;
  onChange: (action: string, shortcut: string) => void;
  actionId: string;
}) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }

      // 忽略单独的修饰键
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');

      // 转换 key 名称
      let key = e.key;
      if (key.length === 1) key = key.toUpperCase();
      else if (key === ' ') key = 'Space';
      else if (key === 'ArrowUp') key = 'Up';
      else if (key === 'ArrowDown') key = 'Down';
      else if (key === 'ArrowLeft') key = 'Left';
      else if (key === 'ArrowRight') key = 'Right';

      parts.push(key);
      const shortcutStr = parts.join('+');
      onChange(actionId, shortcutStr);
      setRecording(false);
    },
    [recording, onChange, actionId]
  );

  useEffect(() => {
    if (recording) {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [recording, handleKeyDown]);

  const parts = parseShortcutDisplay(value);

  return (
    <button
      ref={ref}
      onClick={() => setRecording(!recording)}
      onBlur={() => setRecording(false)}
      className={cn(
        'flex min-w-[120px] items-center gap-1 rounded-md border px-2.5 py-1.5 transition-all duration-150',
        recording
          ? 'border-primary bg-primary/10 shadow-[0_0_0_2px_rgba(var(--primary),0.2)]'
          : 'border-border bg-muted/50 hover:border-primary/40 hover:bg-accent/50'
      )}
    >
      {recording ? (
        <span className="text-[11px] text-primary animate-pulse">按下快捷键...</span>
      ) : (
        parts.map((part, i) => (
          <span key={i} className="flex items-center gap-0.5">
            {i > 0 && <span className="text-[10px] text-muted-foreground/50">+</span>}
            <kbd className="kbd">{part}</kbd>
          </span>
        ))
      )}
    </button>
  );
}

function AppearanceSettings() {
  const { t } = useTranslation();
  const { theme, setTheme, skin, setSkin, resetAppearance, scheme } = useTheme();
  const modes = [
    { id: 'light' as const, icon: Sun },
    { id: 'dark' as const, icon: Moon },
    { id: 'system' as const, icon: Monitor },
  ];

  return (
    <div className="space-y-5 px-2 py-1">
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{t('theme.appearance')}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('theme.appearanceDesc')}</p>
          </div>
          <button
            type="button"
            onClick={resetAppearance}
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {t('theme.restoreDefault')}
          </button>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/60 p-1">
          {modes.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              aria-pressed={theme === id}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                theme === id ? 'bg-card text-foreground shadow-tinted-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`theme.${id}`)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-foreground">{t('theme.skin')}</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t('theme.skinDesc')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {SKIN_IDS.map((skinId) => {
            const tokens = getThemeTokens(skinId, scheme);
            const selected = skin === skinId;
            return (
              <button
                key={skinId}
                type="button"
                onClick={() => setSkin(skinId)}
                aria-pressed={selected}
                className={cn(
                  'group relative overflow-hidden rounded-lg border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected ? 'border-primary bg-primary/5 shadow-tinted-sm' : 'border-border hover:border-primary/45 hover:bg-accent/35'
                )}
              >
                <span className="mb-3 flex h-9 items-end gap-1 rounded-md border border-black/5 p-1.5 dark:border-white/10" style={{ backgroundColor: `hsl(${tokens.background})` }}>
                  <span className="h-4 w-5 rounded-sm" style={{ backgroundColor: `hsl(${tokens.primary})` }} />
                  <span className="h-2.5 flex-1 rounded-sm" style={{ backgroundColor: `hsl(${tokens.muted})` }} />
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: `hsl(${tokens.success})` }} />
                </span>
                <span className="block text-[13px] font-semibold text-foreground">{t(`theme.${skinId}`)}</span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">{t(`theme.${skinId}Desc`)}</span>
                {selected && (
                  <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<'appearance' | 'alwaysOn' | 'pinned' | 'hotkeys'>('alwaysOn');
  const alwaysOnTools = useToolLifecycleStore((s) => s.alwaysOnTools);
  const activeTools = useToolLifecycleStore((s) => s.activeTools);
  const setAlwaysOn = useToolLifecycleStore((s) => s.setAlwaysOn);
  const pinnedTools = useAppStore((s) => s.pinnedTools);
  const togglePinnedTool = useAppStore((s) => s.togglePinnedTool);

  // 快捷键状态
  const [hotkeys, setHotkeys] = useState<Record<string, string>>({});
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  const categories = useMemo(() => getAvailableCategories(), []);

  useEffect(() => {
    if (open) {
      setFilter('');
      setTab('alwaysOn');
      setHotkeyError(null);
      // 加载快捷键配置
      if (isTauri) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke<Record<string, string>>('get_hotkeys').then(setHotkeys).catch(() => {});
        });
      }
    }
  }, [open]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleHotkeyChange = useCallback(
    (action: string, shortcut: string) => {
      setHotkeyError(null);
      if (isTauri) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('update_hotkey', { action, shortcut })
            .then(() => {
              setHotkeys((prev) => ({ ...prev, [action]: shortcut }));
              emitHotkeysChanged({ [action]: shortcut });
            })
            .catch((err: string) => {
              setHotkeyError(err);
            });
        });
      } else {
        // Web 模式仅本地更新
        setHotkeys((prev) => ({ ...prev, [action]: shortcut }));
      }
    },
    []
  );

  const handleResetHotkeys = useCallback(() => {
    if (isTauri) {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('reset_hotkeys')
          .then(() => invoke<Record<string, string>>('get_hotkeys'))
          .then((hotkeys) => {
            setHotkeys(hotkeys);
            emitHotkeysChanged(hotkeys);
          })
          .catch(() => {});
      });
    }
  }, []);

  if (!open) return null;

  const filteredCategories = categories
    .map((category) => ({
      category,
      tools: getToolsByCategory(category).filter(
        (tool) =>
          !filter.trim() ||
          tool.name.toLowerCase().includes(filter.toLowerCase()) ||
          t(`tools.${tool.id}`, tool.name).toLowerCase().includes(filter.toLowerCase()) ||
          tool.keywords.some((k) => k.includes(filter.toLowerCase()))
      ),
    }))
    .filter((c) => c.tools.length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      {/* 背景幕 */}
      <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] animate-fade-in" onClick={onClose} />

      {/* 对话框 */}
      <div className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-popover shadow-tinted-lg animate-scale-in">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Pin className="h-3.5 w-3.5 text-primary" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t('app.settings')}</h2>
              <p className="text-[11px] text-muted-foreground">{t('app.settingsDesc')}</p>
            </div>
          </div>
          <button
            onClick={() => setTab('appearance')}
            className={cn(
              'flex items-center gap-1.5 rounded-t-md px-3 py-2 text-[12px] font-medium transition-colors',
              tab === 'appearance' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Palette className="h-3 w-3" />
            {t('theme.appearance')}
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex items-center gap-1 border-b border-border/60 px-5 pt-2.5 pb-0">
          <button
            onClick={() => setTab('alwaysOn')}
            className={cn(
              'flex items-center gap-1.5 rounded-t-md px-3 py-2 text-[12px] font-medium transition-colors',
              tab === 'alwaysOn'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Pin className="h-3 w-3" />
            {t('app.alwaysOnTools')}
          </button>
          <button
            onClick={() => setTab('pinned')}
            className={cn(
              'flex items-center gap-1.5 rounded-t-md px-3 py-2 text-[12px] font-medium transition-colors',
              tab === 'pinned'
                ? 'border-b-2 border-warning text-warning'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Zap className="h-3 w-3" />
            {t('app.pinnedBar')}
          </button>
          <button
            onClick={() => setTab('hotkeys')}
            className={cn(
              'flex items-center gap-1.5 rounded-t-md px-3 py-2 text-[12px] font-medium transition-colors',
              tab === 'hotkeys'
                ? 'border-b-2 border-info text-info'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Keyboard className="h-3 w-3" />
            {t('app.hotkeys')}
          </button>
        </div>

        {/* 筛选 / 快捷键头部 */}
        {tab === 'appearance' ? null : tab === 'hotkeys' ? (
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-2.5">
            <span className="text-[11px] text-muted-foreground">{t('hotkeys.hint')}</span>
            <button
              onClick={handleResetHotkeys}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              {t('hotkeys.reset')}
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 border-b border-border/60 px-5 py-2.5">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('app.searchPlaceholder')}
              className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60"
              autoFocus
            />
            {tab === 'alwaysOn' ? (
              <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[10px] font-medium text-success">
                {alwaysOnTools.length} {t('app.alwaysOn')}
              </span>
            ) : (
              <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 font-mono text-[10px] font-medium text-warning">
                {pinnedTools.length} {t('app.pinnedCount')}
              </span>
            )}
          </div>
        )}

        {/* 内容区 */}
        <div className="max-h-[46vh] overflow-y-auto px-3 py-3">
          {tab === 'appearance' ? (
            <AppearanceSettings />
          ) : tab === 'hotkeys' ? (
            /* 快捷键配置 */
            <div className="space-y-1 px-2">
              {hotkeyError && (
                <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                  {hotkeyError}
                </div>
              )}
              {HOTKEY_ACTIONS.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center justify-between rounded-lg px-2.5 py-3 transition-colors hover:bg-accent/30"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-[13px] font-medium text-foreground">
                      {t(action.labelKey)}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {t(action.descKey)}
                    </span>
                  </div>
                  <HotkeyRecorder
                    value={hotkeys[action.id] || ''}
                    onChange={handleHotkeyChange}
                    actionId={action.id}
                  />
                </div>
              ))}
              {!isTauri && (
                <div className="mt-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-[11px] text-muted-foreground">
                  {t('hotkeys.desktopOnly')}
                </div>
              )}
            </div>
          ) : filteredCategories.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Search className="h-6 w-6 text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground">{t('app.noResults')}</span>
            </div>
          ) : (
            filteredCategories.map(({ category, tools }) => {
              const CategoryIcon = CATEGORY_ICONS[category];
              return (
                <div key={category} className="mb-3 last:mb-0">
                  {/* 分类标题 */}
                  <div className="mb-1.5 flex items-center gap-2 px-2">
                    <CategoryIcon className="h-3.5 w-3.5 text-primary/70" />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {t(`categories.${category}`)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground/50">{tools.length}</span>
                  </div>
                  {/* 工具行 */}
                  <div className="space-y-0.5">
                    {tools.map((tool) => {
                      if (tab === 'alwaysOn') {
                        const isOn = alwaysOnTools.includes(tool.id);
                        const isRunning = activeTools.includes(tool.id);
                        return (
                          <div
                            key={tool.id}
                            className={cn(
                              'flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-150',
                              isOn ? 'bg-success/[0.06]' : 'hover:bg-accent/50'
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
                                isOn ? 'bg-success/15' : 'bg-muted/70'
                              )}
                            >
                              <tool.icon
                                className={cn('h-3.5 w-3.5', isOn ? 'text-success' : 'text-muted-foreground')}
                              />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-medium text-foreground">
                                  {t(`tools.${tool.id}`, tool.name)}
                                </span>
                                {isRunning && !isOn && (
                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success animate-glow-pulse" />
                                )}
                              </div>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {tool.description}
                              </span>
                            </div>
                            <Toggle checked={isOn} onChange={(v) => setAlwaysOn(tool.id, v)} />
                          </div>
                        );
                      } else {
                        // 快捷栏 tab
                        const isPinned = pinnedTools.includes(tool.id);
                        return (
                          <div
                            key={tool.id}
                            className={cn(
                              'flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-150',
                              isPinned ? 'bg-warning/[0.06]' : 'hover:bg-accent/50'
                            )}
                          >
                            <span
                              className={cn(
                                'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
                                isPinned ? 'bg-warning/15' : 'bg-muted/70'
                              )}
                            >
                              <tool.icon
                                className={cn('h-3.5 w-3.5', isPinned ? 'text-warning' : 'text-muted-foreground')}
                              />
                            </span>
                            <div className="min-w-0 flex-1">
                              <span className="truncate text-[13px] font-medium text-foreground">
                                {t(`tools.${tool.id}`, tool.name)}
                              </span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {tool.description}
                              </span>
                            </div>
                            <Toggle checked={isPinned} onChange={() => togglePinnedTool(tool.id)} />
                          </div>
                        );
                      }
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-5 py-2.5 text-[10px] text-muted-foreground">
          {tab === 'appearance' ? (
            <span className="flex items-center gap-1.5">
              <Palette className="h-3 w-3 text-primary" />
              {t('theme.appearanceDesc')}
            </span>
          ) : tab === 'alwaysOn' ? (
            <>
              <span className="flex items-center gap-1.5">
                <Power className="h-3 w-3 text-success" />
                {t('app.runningCount', { count: activeTools.length })}
              </span>
              <span className="flex items-center gap-1.5">
                <Pin className="h-3 w-3 text-warning" />
                {t('app.alwaysOnCount', { count: alwaysOnTools.length })}
              </span>
              <span className="ml-auto">{t('app.alwaysOnHint')}</span>
            </>
          ) : tab === 'pinned' ? (
            <>
              <span className="flex items-center gap-1.5">
                <Zap className="h-3 w-3 text-warning" />
                {t('app.pinnedBarHint')}
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1.5">
                <Keyboard className="h-3 w-3 text-info" />
                {t('hotkeys.footerHint')}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
