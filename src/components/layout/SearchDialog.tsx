import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Fuse from 'fuse.js';
import { cn } from '@/lib/utils';
import { getRecentToolIds, useAppStore } from '@/store/app-store';
import { getAllTools, getAvailableCategories, preloadTool } from '@/registry/tool-registry';
import { buildToolSearchText, matchesSearchText } from '@/lib/pinyin-search';
import { EmptyState } from '@/components/shared/EmptyState';
import type { ToolCategory } from '@/types/tool';
import zhLocale from '@/i18n/locales/zh.json';
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
  const [categoryFilter, setCategoryFilter] = useState<ToolCategory | 'all'>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const tools = useMemo(() => getAllTools(), []);
  const categories = useMemo(() => getAvailableCategories(), []);

  const searchable = useMemo(
    () =>
      tools.map((tool) => {
        const localizedName = t(`tools.${tool.id}`, tool.name);
        const categoryLabel = t(`categories.${tool.category}`);
        const zhName = zhLocale.tools[tool.id as keyof typeof zhLocale.tools] ?? tool.name;
        const zhCategory = zhLocale.categories[tool.category as keyof typeof zhLocale.categories] ?? '';
        return {
          ...tool,
          localizedName,
          categoryLabel,
          searchText: buildToolSearchText([tool.id, localizedName, tool.name, zhName, tool.description, tool.keywords, categoryLabel, zhCategory]),
        };
      }),
    [t, tools]
  );

  const fuse = useMemo(
    () =>
      new Fuse(searchable, {
        keys: [
          { name: 'localizedName', weight: 2.5 },
          { name: 'searchText', weight: 2 },
          { name: 'keywords', weight: 1.5 },
          { name: 'description', weight: 1 },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    [searchable]
  );

  const searchResults = useMemo(() => {
    const pool = categoryFilter === 'all' ? searchable : searchable.filter((tool) => tool.category === categoryFilter);
    const needle = query.trim().toLowerCase();
    if (!needle) return pool;
    const compact = needle.replace(/\s+/g, '');
    const direct = pool.filter(
      (tool) =>
        tool.searchText.includes(compact) ||
        tool.localizedName.toLowerCase().includes(needle) ||
        matchesSearchText(tool.searchText, needle)
    );
    if (direct.length > 0) return direct;
    const fuseForPool =
      categoryFilter === 'all'
        ? fuse
        : new Fuse(pool, {
            keys: [
              { name: 'localizedName', weight: 2.5 },
              { name: 'searchText', weight: 2 },
              { name: 'keywords', weight: 1.5 },
              { name: 'description', weight: 1 },
            ],
            threshold: 0.4,
            includeScore: true,
          });
    return fuseForPool.search(query).map((result) => result.item);
  }, [categoryFilter, fuse, query, searchable]);

  const sections = useMemo(() => {
    if (query.trim() || categoryFilter !== 'all') return [{ id: 'search-results', label: t('app.searchResults'), tools: searchResults }];

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
  }, [categoryFilter, pinnedTools, query, recentToolUsage, searchResults, t, tools]);

  const displayedTools = useMemo(() => sections.flatMap((section) => section.tools), [sections]);

  useEffect(() => {
    if (searchOpen) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setQuery('');
      setCategoryFilter('all');
      setSelectedIndex(0);
      const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 50);
      return () => window.clearTimeout(focusTimer);
    } else {
      previousFocusRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, categoryFilter]);

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
    selected?.scrollIntoView?.({ block: 'nearest' });
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

        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2" role="toolbar" aria-label={t('app.allCategories')}>
          <button
            type="button"
            onClick={() => setCategoryFilter('all')}
            aria-pressed={categoryFilter === 'all'}
            className={cn(
              'min-h-8 rounded-full px-2.5 py-1 text-[11px] transition-colors',
              categoryFilter === 'all' ? 'bg-primary/12 text-foreground ring-1 ring-primary/25' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            {t('app.allCategories')}
          </button>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setCategoryFilter(category)}
              aria-pressed={categoryFilter === category}
              className={cn(
                'min-h-8 rounded-full px-2.5 py-1 text-[11px] transition-colors',
                categoryFilter === category ? 'bg-primary/12 text-foreground ring-1 ring-primary/25' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {t(`categories.${category}`)}
            </button>
          ))}
        </div>

        {/* 结果列表 */}
        <div ref={listRef} id="tool-search-results" role="listbox" aria-label={t('app.searchTools')} className="max-h-80 overflow-y-auto p-2">
          {displayedTools.length === 0 ? (
            <EmptyState icon={Search} title={t('app.noResults', 'No matching tools found')} description={t('app.noResultsHint')} className="py-10" />
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
