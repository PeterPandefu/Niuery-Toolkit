import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { createKeyValue, type KeyValue } from '@/store/api-tester-store';

interface KeyValueEditorProps {
  items: KeyValue[];
  onChange: (items: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  className?: string;
}

export function KeyValueEditor({
  items,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  className,
}: KeyValueEditorProps) {
  const addItem = useCallback(() => {
    onChange([...items, createKeyValue()]);
  }, [items, onChange]);

  const removeItem = useCallback(
    (id: string) => {
      onChange(items.filter((item) => item.id !== id));
    },
    [items, onChange]
  );

  const updateItem = useCallback(
    (id: string, partial: Partial<KeyValue>) => {
      onChange(items.map((item) => (item.id === id ? { ...item, ...partial } : item)));
    },
    [items, onChange]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      e.dataTransfer.setData('text/plain', String(index));
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
      if (isNaN(fromIndex) || fromIndex === toIndex) return;
      const newItems = [...items];
      const [moved] = newItems.splice(fromIndex, 1);
      newItems.splice(toIndex, 0, moved);
      onChange(newItems);
    },
    [items, onChange]
  );

  return (
    <div className={cn('space-y-1', className)}>
      {items.map((item, index) => (
        <div
          key={item.id}
          draggable
          onDragStart={(e) => handleDragStart(e, index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handleDrop(e, index)}
          className="group flex items-center gap-1.5"
        >
          <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground/40 opacity-0 group-hover:opacity-100" />
          <input
            type="checkbox"
            checked={item.enabled}
            onChange={(e) => updateItem(item.id, { enabled: e.target.checked })}
            className="h-3.5 w-3.5 shrink-0 rounded border-input accent-primary"
          />
          <input
            value={item.key}
            onChange={(e) => updateItem(item.id, { key: e.target.value })}
            placeholder={keyPlaceholder}
            className="h-8 flex-1 rounded-md border bg-background px-2.5 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
          />
          <input
            value={item.value}
            onChange={(e) => updateItem(item.id, { value: e.target.value })}
            placeholder={valuePlaceholder}
            className="h-8 flex-1 rounded-md border bg-background px-2.5 text-sm font-mono outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100"
            onClick={() => removeItem(item.id)}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addItem}>
        <Plus className="h-3.5 w-3.5" />
        添加
      </Button>
    </div>
  );
}
