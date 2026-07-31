import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { extractOutline } from '@/lib/markdown-utils';
import { ListTree } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OutlineProps {
  content: string;
  onJumpToLine: (line: number) => void;
  className?: string;
}

export function Outline({ content, onJumpToLine, className }: OutlineProps) {
  const { t } = useTranslation();
  const items = useMemo(() => extractOutline(content), [content]);

  if (items.length === 0) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <div className="flex items-center gap-1.5 border-b px-3 py-1.5">
          <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">{t('markdownEditor.outline')}</span>
        </div>
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {t('markdownEditor.outlineEmpty')}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center gap-1.5 border-b px-3 py-1.5">
        <ListTree className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">{t('markdownEditor.outline')}</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-1">
        {items.map((item, i) => (
          <button
            key={`${item.line}-${i}`}
            className={cn(
              'block w-full truncate rounded-sm px-3 py-1 text-left text-xs transition-colors',
              'hover:bg-accent hover:text-accent-foreground',
              item.level === 1 && 'font-semibold',
              item.level === 2 && 'font-medium'
            )}
            style={{ paddingLeft: `${(item.level - 1) * 12 + 12}px` }}
            onClick={() => onJumpToLine(item.line)}
            title={item.text}
          >
            {item.text}
          </button>
        ))}
      </nav>
    </div>
  );
}
