import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Fuse from 'fuse.js';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/store/app-store';
import { getAllTools } from '@/registry/tool-registry';
import { Search } from 'lucide-react';

interface SearchDialogProps {
  onSelectTool: (toolId: string) => void;
}

export function SearchDialog({ onSelectTool }: SearchDialogProps) {
  const { t } = useTranslation();
  const { searchOpen, setSearchOpen } = useAppStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  const results = useMemo(() => {
    if (!query.trim()) return tools;
    return fuse.search(query).map((r) => r.item);
  }, [query, fuse, tools]);

  useEffect(() => {
    if (searchOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
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
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, setSearchOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      onSelectTool(results[selectedIndex].id);
      setSearchOpen(false);
    }
  };

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex] as HTMLElement;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!searchOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh]">
      {/* 背景幕 */}
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px] animate-fade-in"
        onClick={() => setSearchOpen(false)}
      />

      {/* 对话框 */}
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-tinted-lg animate-scale-in">
        {/* 搜索输入 */}
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-primary" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('app.searchPlaceholder')}
            className="flex h-12 w-full bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="kbd">ESC</kbd>
        </div>

        {/* 结果列表 */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Search className="h-6 w-6 text-muted-foreground/40" />
              <span className="text-sm text-muted-foreground">
                {t('app.noResults', 'No matching tools found')}
              </span>
            </div>
          ) : (
            results.map((tool, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={tool.id}
                  onClick={() => {
                    onSelectTool(tool.id);
                    setSearchOpen(false);
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
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
                </button>
              );
            })
          )}
        </div>

        {/* 键盘操作提示 */}
        <div className="flex items-center gap-3 border-t border-border bg-muted/30 px-4 py-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd>
            导航
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">↵</kbd>
            打开
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">ESC</kbd>
            关闭
          </span>
        </div>
      </div>
    </div>
  );
}
