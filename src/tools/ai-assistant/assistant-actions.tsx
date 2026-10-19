import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Pencil, Plus, Settings, Trash2 } from 'lucide-react';
import { iconLabel, useAiText } from './ui-text';

export function AssistantActions({ canDelete, onNew, onEdit, onDuplicate, onDelete }: {
  canDelete: boolean; onNew(): void; onEdit(): void; onDuplicate(): void; onDelete(): void;
}) {
  const t = useAiText();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('.ai-assistant-options button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function choose(action: () => void) {
    setOpen(false); trigger.current?.focus(); action();
  }

  return <div ref={root} className="ai-assistant-actions" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="ai-icon-button" {...iconLabel(t('助手设置', 'Assistant settings'))} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><Settings size={17} aria-hidden="true" /></button>
    {open && <div id={id} className="ai-assistant-options" role="group" aria-label={t('助手操作', 'Assistant actions')}>
      <span>{t('管理助手', 'MANAGE ASSISTANT')}</span>
      <button type="button" onClick={() => choose(onNew)}><Plus size={15} aria-hidden="true" />{t('新建助手', 'New assistant')}</button>
      <button type="button" onClick={() => choose(onEdit)}><Pencil size={15} aria-hidden="true" />{t('编辑助手', 'Edit assistant')}</button>
      <button type="button" onClick={() => choose(onDuplicate)}><Copy size={15} aria-hidden="true" />{t('复制助手', 'Duplicate assistant')}</button>
      <button type="button" className="ai-danger" disabled={!canDelete} onClick={() => choose(onDelete)}><Trash2 size={15} aria-hidden="true" />{t('删除助手', 'Delete assistant')}</button>
    </div>}
  </div>;
}
