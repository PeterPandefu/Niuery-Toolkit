import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { isResourceDesktop, openResourceManager, type ResourceId } from '@/lib/resources';
import { useResourceStore } from '@/store/resource-store';
import { Button } from '@/components/ui/button';
import { ResourceManager } from './ResourceManager';
import { useResourceEvents } from '@/store/resource-store';

export function ResourceNotice({ ids }: { ids: ResourceId[] }) {
  const { i18n } = useTranslation();
  const zh = (i18n.language || 'zh').startsWith('zh');
  const { resources, refresh, error } = useResourceStore();
  const [open, setOpen] = useState(false);
  useResourceEvents();
  const key = ids.join(',');
  useEffect(() => { if (key) void refresh(); }, [key, refresh]);
  if (!isResourceDesktop() || !ids.length) return null;
  const missing = ids.filter(id => !resources.some(r => r.id === id && r.status === 'ready'));
  if (!missing.length && !error && !open) return null;
  return <>{(missing.length > 0 || error) && <aside className="flex shrink-0 flex-wrap items-center gap-3 border-b border-warning/30 bg-warning/5 px-4 py-2 text-xs" aria-label={zh ? '功能资源提示' : 'Feature resources'}>
    <p className="min-w-0 flex-1">{zh ? '部分功能需要准备资源；其他功能仍可正常使用。' : 'Some features require resources; other features remain available.'} <span className="font-mono">{missing.join(', ')}</span></p>
    <Button size="sm" variant="outline" onClick={() => { if (window.location.hash.startsWith('#/screenshot')) setOpen(true); else openResourceManager(); }}>{zh ? '管理资源' : 'Manage resources'}</Button>
  </aside>}
    {open && createPortal(<div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-6" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-label={zh ? '资源管理' : 'Resources'} className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-border bg-background p-4 text-foreground shadow-xl">
        <div className="flex items-center justify-between"><h2>{zh ? '资源管理' : 'Resources'}</h2><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{zh ? '关闭' : 'Close'}</Button></div>
        <ResourceManager />
      </div>
    </div>, document.body)}
  </>;
}
