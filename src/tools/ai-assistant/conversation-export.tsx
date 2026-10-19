import { useEffect, useId, useRef, useState } from 'react';
import { Download, FileJson, FileText } from 'lucide-react';
import { iconLabel, useAiText } from './ui-text';

export function ConversationExport({ onExport }: { onExport(format: 'markdown' | 'json'): void }) {
  const t = useAiText();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('.ai-export-options button')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  return <div ref={root} className="ai-export" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (open && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    }
  }}>
    <button ref={trigger} type="button" className="ai-icon-button" {...iconLabel(t('导出会话', 'Export conversation'))} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}><Download size={17} /></button>
    {open && <div id={id} className="ai-export-options" role="group" aria-label={t('导出格式', 'Export format')}>
      <span>{t('导出会话', 'Export conversation')}</span>
      {(['markdown', 'json'] as const).map(format => <button type="button" key={format} onClick={() => { setOpen(false); trigger.current?.focus(); onExport(format); }}>
        {format === 'markdown' ? <FileText size={15} /> : <FileJson size={15} />}{format === 'markdown' ? 'Markdown' : 'JSON'}
      </button>)}
    </div>}
  </div>;
}
