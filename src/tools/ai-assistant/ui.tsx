import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useAiText } from './ui-text';

const dialogStack: HTMLDivElement[] = [];

export function AiDialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose(): void; wide?: boolean }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const t = useAiText();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    if (panel) dialogStack.push(panel);
    panel?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const listener = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const nodes = [...(panel?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]') ?? [])];
      if (!nodes.length) { event.preventDefault(); return; }
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
    };
    document.addEventListener('keydown', listener, true);
    return () => { document.removeEventListener('keydown', listener, true); if (panel) { const index = dialogStack.indexOf(panel); if (index >= 0) dialogStack.splice(index, 1); } previous?.focus(); };
  }, []);
  return createPortal(<div className="ai-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} className={`ai-dialog ${wide ? 'ai-dialog-wide' : ''}`}>
      <header><h2 id={id}>{title}</h2><button type="button" className="ai-icon-button" aria-label={t('关闭', 'Close')} onClick={onClose}><X size={18} /></button></header>
      {children}
    </div>
  </div>, document.body);
}

export function AiError({ error }: { error: unknown }) {
  if (!error) return null;
  return <div role="alert" className="ai-error">{error instanceof Error ? error.message : String(error)}</div>;
}
