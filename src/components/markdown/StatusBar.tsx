import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getDocStats } from '@/lib/markdown-utils';

interface StatusBarProps {
  content: string;
  /** 光标所在行（1-based） */
  cursorLine?: number;
  /** 光标所在列（1-based） */
  cursorColumn?: number;
}

export function StatusBar({ content, cursorLine, cursorColumn }: StatusBarProps) {
  const { t } = useTranslation();
  const stats = useMemo(() => getDocStats(content), [content]);

  return (
    <div className="flex items-center gap-3 border-t px-3 py-1 text-[11px] text-muted-foreground select-none">
      {cursorLine !== undefined && cursorColumn !== undefined && (
        <span>{t('markdownEditor.status.line', { line: cursorLine, col: cursorColumn })}</span>
      )}
      <span>{t('markdownEditor.status.lines', { count: stats.lines })}</span>
      <span>{t('markdownEditor.status.words', { count: stats.words })}</span>
      <span>{t('markdownEditor.status.chars', { count: stats.chars })}</span>
      {stats.readingTime > 0 && (
        <span>{t('markdownEditor.status.readingTime', { min: stats.readingTime })}</span>
      )}
      <span className="ml-auto">Markdown</span>
    </div>
  );
}
