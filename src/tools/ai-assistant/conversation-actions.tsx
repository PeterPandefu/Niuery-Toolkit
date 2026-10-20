import { useEffect, useId, useRef, useState } from 'react';
import { Archive, MoreVertical, Pencil, Pin, Trash2 } from 'lucide-react';
import type { AiConversation } from './types';
import { iconLabel, useAiText } from './ui-text';

export function ConversationActions({ item, disabled, onPin, onArchive, onRename, onDelete }: {
  item: AiConversation;
  disabled?: boolean;
  onPin(): void;
  onArchive(): void;
  onRename(): void;
  onDelete(): void;
}) {
  const t = useAiText();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('.ai-conversation-options button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    trigger.current?.focus();
    action();
  }

  return <div ref={root} className="ai-conversation-actions" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="ai-icon-button" {...iconLabel(t('会话操作', 'Conversation actions'))} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <MoreVertical size={16} aria-hidden="true" />
    </button>
    {open && <div id={id} className="ai-conversation-options" role="menu" aria-label={`${t('会话操作', 'Conversation actions')}: ${item.title}`}>
      <button type="button" role="menuitem" onClick={() => choose(onPin)}><Pin size={14} aria-hidden="true" />{item.pinned ? t('取消置顶', 'Unpin') : t('置顶', 'Pin')}</button>
      <button type="button" role="menuitem" onClick={() => choose(onArchive)}><Archive size={14} aria-hidden="true" />{item.archived ? t('取消归档', 'Unarchive') : t('归档', 'Archive')}</button>
      <button type="button" role="menuitem" onClick={() => choose(onRename)}><Pencil size={14} aria-hidden="true" />{t('编辑', 'Edit')}</button>
      <button type="button" role="menuitem" className="ai-danger" disabled={disabled} onClick={() => choose(onDelete)}><Trash2 size={14} aria-hidden="true" />{t('删除', 'Delete')}</button>
    </div>}
  </div>;
}
