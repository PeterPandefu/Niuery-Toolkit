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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 animate-fade-in"
        onClick={() => setSearchOpen(false)}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-lg rounded-lg border bg-background shadow-lg animate-slide-in">
        {/* Search Input */}
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('app.searchPlaceholder')}
            className="flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {t('app.noResults', 'No matching tools found')}
            </div>
          ) : (
            results.map((tool, index) => (
              <button
                key={tool.id}
                onClick={() => {
                  onSelectTool(tool.id);
                  setSearchOpen(false);
                }}
                onMouseEnter={() => setSelectedIndex(index)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  index === selectedIndex && 'bg-accent'
                )}
              >
                <tool.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{t(`tools.${tool.id}`, tool.name)}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {tool.description}
                  </div>
                </div>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {t(`categories.${tool.category}`)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
