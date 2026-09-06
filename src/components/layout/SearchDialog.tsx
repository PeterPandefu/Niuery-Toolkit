import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Fuse from 'fuse.js';
import { cn } from '@/lib/utils';
import { getRecentToolIds, useAppStore } from '@/store/app-store';
import { getAllTools, preloadTool } from '@/registry/tool-registry';
import { Search } from 'lucide-react';

interface SearchDialogProps {
  onSelectTool: (toolId: string) => void;
}

export function SearchDialog({ onSelectTool }: SearchDialogProps) {
  const { t } = useTranslation();
  const { searchOpen, setSearchOpen } = useAppStore();
  const pinnedTools = useAppStore((state) => state.pinnedTools);
  const recentToolUsage = useAppStore((state) => state.recentToolUsage);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const tools = useMemo(() => getAllTools(), []);

  const fuse = useMemo(
    () =>
      new Fuse(tools, {
        keys: [
          { name: 'name', weight: 2 },
          { name: 'keywords', weight: 1.5 },
          { name: 'description', weight: 1 },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    [tools]
  );

  const searchResults = useMemo(() => {
    if (!query.trim()) return tools;
    return fuse.search(query).map((r) => r.item);
  }, [query, fuse, tools]);

  const sections = useMemo(() => {
    if (query.trim()) return [{ id: 'search-results', label: t('app.searchResults'), tools: searchResults }];

    const toolsById = new Map(tools.map((tool) => [tool.id, tool]));
    const pinned = pinnedTools.map((id) => toolsById.get(id)).filter((tool): tool is (typeof tools)[number] => Boolean(tool));
    const pinnedIds = new Set(pinned.map((tool) => tool.id));
    const recent = getRecentToolIds(recentToolUsage, 6)
      .filter((id) => !pinnedIds.has(id))
      .map((id) => toolsById.get(id))
      .filter((tool): tool is (typeof tools)[number] => Boolean(tool));
    const visibleIds = new Set([...pinnedIds, ...recent.map((tool) => tool.id)]);
    const remaining = tools.filter((tool) => !visibleIds.has(tool.id));

    return [
      { id: 'pinned-tools', label: t('app.pinnedBar'), tools: pinned },
      { id: 'recent-tools', label: t('app.recentTools'), tools: recent },
      { id: 'all-tools', label: t('app.allTools'), tools: remaining },
    ].filter((section) => section.tools.length > 0);
  }, [pinnedTools, query, recentToolUsage, searchResults, t, tools]);

  const displayedTools = useMemo(() => sections.flatMap((section) => section.tools), [sections]);

  useEffect(() => {
    if (searchOpen) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      setSelectedIndex(0);
      const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(focusTimer);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(!searchOpen);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, setSearchOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (displayedTools.length > 0) setSelectedIndex((i) => Math.min(i + 1, displayedTools.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (displayedTools.length > 0) setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && displayedTools[selectedIndex]) {
      onSelectTool(displayedTools[selectedIndex].id);
      setSearchOpen(false);
    }
  };

  const handleDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    const selected = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[selectedIndex];
    selected?.scrollIntoView({ block: 'nearest' });
    const selectedTool = displayedTools[selectedIndex];
    if (selectedTool) preloadTool(selectedTool.id);
  }, [displayedTools, selectedIndex]);

  if (!searchOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]" role="presentation">
      {/* 背景幕 */}
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px] animate-fade-in"
        onClick={() => setSearchOpen(false)}
      />

      {/* 对话框 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tool-search-title"
        onKeyDown={handleDialogKeyDown}
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-tinted-lg animate-scale-in"
      >
        <h2 id="tool-search-title" className="sr-only">{t('app.searchTools')}</h2>
        {/* 搜索输入 */}
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-primary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('app.searchPlaceholder')}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="tool-search-results"
            aria-activedescendant={displayedTools[selectedIndex] ? `tool-search-option-${displayedTools[selectedIndex].id}` : undefined}
            className="flex h-12 w-full bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="kbd" aria-label={t('app.searchClose')}>ESC</kbd>
        </div>

        {/* 结果列表 */}
        <div ref={listRef} id="tool-search-results" role="listbox" aria-label={t('app.searchTools')} className="max-h-80 overflow-y-auto p-2">
          {displayedTools.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Search className="h-6 w-6 text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground">
                {t('app.noResults', 'No matching tools found')}
              </span>
              <span className="text-xs text-muted-foreground/75">{t('app.noResultsHint')}</span>
            </div>
          ) : (
            sections.map((section) => {
              const sectionStart = displayedTools.findIndex((tool) => tool.id === section.tools[0]?.id);
              return (
                <div key={section.id} role="group" aria-labelledby={`tool-search-section-${section.id}`}>
                  <div id={`tool-search-section-${section.id}`} className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {section.label}
                  </div>
                  {section.tools.map((tool, sectionIndex) => {
                    const index = sectionStart + sectionIndex;
                    const selected = index === selectedIndex;
                    return <button
                      key={tool.id}
                      id={`tool-search-option-${tool.id}`}
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onSelectTool(tool.id);
                        setSearchOpen(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onPointerEnter={() => preloadTool(tool.id)}
                      className={cn(
                        'relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-100',
                        selected ? 'bg-accent' : 'hover:bg-accent/50'
                      )}
                    >
                  {/* 选中指示条 */}
                  <span
                    className={cn(
                      'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-opacity',
                      selected ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
                      selected ? 'bg-primary/15' : 'bg-muted/70'
                    )}
                  >
                    <tool.icon
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 transition-colors',
                        selected ? 'text-primary' : 'text-muted-foreground'
                      )}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-foreground">
                      {t(`tools.${tool.id}`, tool.name)}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {tool.description}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {t(`categories.${tool.category}`)}
                  </span>
                    </button>;
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* 键盘操作提示 */}
        <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd>
            {t('app.searchNavigate')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">↵</kbd>
            {t('app.searchOpen')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">ESC</kbd>
            {t('app.searchClose')}
          </span>
        </div>
      </div>
    </div>
  );
}
