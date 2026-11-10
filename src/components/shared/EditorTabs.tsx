import { useEffect, useRef, useState } from 'react';
import { Copy, MoreHorizontal, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { EditorTab } from '@/hooks/use-editor-tabs';

interface EditorTabsProps {
  tabs: EditorTab[];
  activeTabId: string;
  onActivate: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseRight: (id: string) => void;
  onCloseAll: (id: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
}

export function EditorTabs({
  tabs, activeTabId, onActivate, onCreate, onDuplicate, onRename, onClose,
  onCloseOthers, onCloseRight, onCloseAll, onReorder,
}: EditorTabsProps) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  useEffect(() => {
    const closeMenu = () => setMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 't') {
        event.preventDefault();
        onCreate();
      } else if (event.key.toLowerCase() === 'w') {
        event.preventDefault();
        onClose(activeTabId);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const index = tabs.findIndex((tab) => tab.id === activeTabId);
        const next = (index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
        onActivate(tabs[next].id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabId, onActivate, onClose, onCreate, tabs]);

  const beginRename = (tab: EditorTab) => {
    setMenu(null);
    setRenamingId(tab.id);
    setRenameValue(tab.name);
  };

  const finishRename = () => {
    if (renamingId) onRename(renamingId, renameValue);
    setRenamingId(null);
  };

  return (
    <div className="relative flex min-h-10 min-w-0 items-center border-b bg-muted/20 px-2">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1" role="tablist" aria-label="编辑器页签">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(event) => event.dataTransfer.setData('text/plain', tab.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                onReorder(event.dataTransfer.getData('text/plain'), tab.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onActivate(tab.id);
                setMenu({ id: tab.id, x: event.clientX, y: event.clientY });
              }}
              className={`group flex h-8 shrink-0 items-center rounded-md border px-1 ${active ? 'border-border bg-background shadow-sm' : 'border-transparent hover:bg-accent/60'}`}
            >
              {renamingId === tab.id ? (
                <input
                  ref={renameRef}
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={finishRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') finishRename();
                    if (event.key === 'Escape') setRenamingId(null);
                  }}
                  className="h-6 w-28 bg-transparent px-1 text-xs outline-none"
                  aria-label="重命名页签"
                />
              ) : (
                <button type="button" role="tab" aria-selected={active} onClick={() => onActivate(tab.id)} onDoubleClick={() => beginRename(tab)} className="max-w-40 truncate px-2 text-xs">
                  {tab.name}
                </button>
              )}
              <Button variant="ghost" size="icon" className="h-6 w-6 opacity-60 hover:opacity-100" onClick={() => onClose(tab.id)} aria-label={`关闭 ${tab.name}`}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onCreate} title="新建页签" aria-label="新建页签"><Plus className="h-4 w-4" /></Button>
      </div>
      {menu && (
        <div className="fixed z-50 min-w-40 rounded-md border bg-popover p-1 text-xs shadow-lg" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => beginRename(tabs.find((tab) => tab.id === menu.id)!)}>重命名</button>
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => { onDuplicate(menu.id); setMenu(null); }}><Copy className="h-3.5 w-3.5" />复制页签</button>
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => { onCloseOthers(menu.id); setMenu(null); }}>关闭其他</button>
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => { onCloseRight(menu.id); setMenu(null); }}>关闭右侧</button>
          <button type="button" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => { onCloseAll(menu.id); setMenu(null); }}>关闭全部</button>
        </div>
      )}
      <MoreHorizontal className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}
