import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Eye,
  EyeOff,
  Trash2,
  ChevronUp,
  ChevronDown,
  ArrowUpRight,
  Square,
  Circle,
  Minus,
  Pencil,
  Type,
  Grid3X3,
  Highlighter,
  Hash,
  Layers,
} from 'lucide-react';
import type { AnnotationData } from './types';
import { useHistory } from './HistoryProvider';

interface LayerPanelProps {
  annotations: AnnotationData[];
  selectedIds: string[];
  onSelectChange: (ids: string[]) => void;
  onAnnotationsChange: (annotations: AnnotationData[]) => void;
}

const TYPE_ICONS: Record<string, typeof Square> = {
  arrow: ArrowUpRight,
  rect: Square,
  ellipse: Circle,
  line: Minus,
  pen: Pencil,
  text: Type,
  mosaic: Grid3X3,
  highlight: Highlighter,
  number: Hash,
};

export function LayerPanel({
  annotations,
  selectedIds,
  onSelectChange,
  onAnnotationsChange,
}: LayerPanelProps) {
  const { t } = useTranslation();
  const { execute } = useHistory();

  const handleToggleVisible = useCallback(
    (id: string) => {
      const prev = [...annotations];
      const updated = annotations.map((a) =>
        a.id === id ? { ...a, visible: !a.visible } : a
      );
      execute({
        label: '切换可见性',
        execute: () => onAnnotationsChange(updated),
        undo: () => onAnnotationsChange(prev),
      });
    },
    [annotations, execute, onAnnotationsChange]
  );

  const handleDelete = useCallback(
    (ids: string[]) => {
      const prev = [...annotations];
      const updated = annotations.filter((a) => !ids.includes(a.id));
      execute({
        label: `删除 ${ids.length} 个图层`,
        execute: () => onAnnotationsChange(updated),
        undo: () => onAnnotationsChange(prev),
      });
      onSelectChange([]);
    },
    [annotations, execute, onAnnotationsChange, onSelectChange]
  );

  const handleMove = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const idx = annotations.findIndex((a) => a.id === id);
      if (idx === -1) return;
      const targetIdx = direction === 'up' ? idx + 1 : idx - 1;
      if (targetIdx < 0 || targetIdx >= annotations.length) return;
      const prev = [...annotations];
      const updated = [...annotations];
      [updated[idx], updated[targetIdx]] = [updated[targetIdx], updated[idx]];
      execute({
        label: direction === 'up' ? '上移图层' : '下移图层',
        execute: () => onAnnotationsChange(updated),
        undo: () => onAnnotationsChange(prev),
      });
    },
    [annotations, execute, onAnnotationsChange]
  );

  const handleItemClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      if (e.shiftKey) {
        onSelectChange(
          selectedIds.includes(id)
            ? selectedIds.filter((sid) => sid !== id)
            : [...selectedIds, id]
        );
      } else {
        onSelectChange([id]);
      }
    },
    [selectedIds, onSelectChange]
  );

  // 倒序显示（最上层在前）
  const reversedAnnotations = [...annotations].reverse();

  return (
    <div className="flex h-full w-52 flex-col border-l bg-background">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Layers className="h-3.5 w-3.5" />
          {t('screenshotEditor.layers')} ({annotations.length})
        </div>
        {selectedIds.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-destructive hover:text-destructive"
            onClick={() => handleDelete(selectedIds)}
            aria-label="删除选中图层"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {reversedAnnotations.length === 0 && (
          <div className="p-4 text-center text-xs text-muted-foreground">
            {t('screenshotEditor.noLayers')}
          </div>
        )}
        {reversedAnnotations.map((annotation) => {
          const Icon = TYPE_ICONS[annotation.type] || Square;
          const isSelected = selectedIds.includes(annotation.id);
          return (
            <div
              key={annotation.id}
              className={cn(
                'group flex items-center gap-1.5 border-b border-transparent px-2 py-1.5 cursor-pointer transition-colors hover:bg-muted/50',
                isSelected && 'bg-primary/10 border-primary/20'
              )}
              onClick={(e) => handleItemClick(annotation.id, e)}
            >
              {/* 可见性 */}
              <button
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleVisible(annotation.id);
                }}
                aria-label={annotation.visible ? '隐藏' : '显示'}
              >
                {annotation.visible ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 opacity-50" />
                )}
              </button>

              {/* 图标 + 名称 */}
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-xs">{annotation.name}</span>

              {/* 操作按钮 */}
              <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMove(annotation.id, 'up');
                  }}
                  aria-label="上移"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMove(annotation.id, 'down');
                  }}
                  aria-label="下移"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
                <button
                  className="text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete([annotation.id]);
                  }}
                  aria-label="删除"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
