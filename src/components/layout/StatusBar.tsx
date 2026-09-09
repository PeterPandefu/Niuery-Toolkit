import { useTranslation } from 'react-i18next';
import { ScrollText } from 'lucide-react';
import { getToolById } from '@/registry/tool-registry';
import { useAppStore } from '@/store/app-store';
import { useLogStore } from '@/store/log-store';
import { cn } from '@/lib/utils';

function UnreadLogBadge() {
  const unreadCount = useLogStore((state) => state.unreadCount);
  if (unreadCount <= 0) return null;
  return (
    <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-semibold tabular-nums leading-4 text-primary">
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  );
}

/** 窗口底部状态条：当前上下文、日志入口与离线状态。 */
export function StatusBar() {
  const { t } = useTranslation();
  const toolId = useAppStore((state) => state.activeToolId);
  const tool = toolId ? getToolById(toolId) : null;
  const unreadCount = useLogStore((state) => state.unreadCount);
  const panelOpen = useLogStore((state) => state.panelOpen);
  const contextLabel = tool ? t(`tools.${tool.id}`, tool.name) : t('app.offlineWorkspace');
  const logsLabel = t('app.logs');

  return (
    <footer className="app-statusbar relative z-[2] flex h-8 shrink-0 items-center gap-2 border-t border-border/60 px-2.5 text-[11px] text-muted-foreground">
      <span className="font-mono text-[10px] tabular-nums tracking-wide text-muted-foreground/80">v{__APP_VERSION__}</span>
      <span className="h-3 w-px shrink-0 bg-border/80" aria-hidden="true" />
      <span className="min-w-0 truncate">{contextLabel}</span>
      <div className="h-full min-w-4 flex-1" data-tauri-drag-region />
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => useLogStore.getState().setPanelOpen(!panelOpen)}
          className={cn(
            'flex h-6 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-accent hover:text-foreground',
            panelOpen && 'bg-accent/80 text-foreground'
          )}
          aria-pressed={panelOpen}
          aria-label={unreadCount > 0 ? `${logsLabel} ${unreadCount}` : logsLabel}
          title={logsLabel}
        >
          <ScrollText className="h-3.5 w-3.5" />
          <span>{logsLabel}</span>
          <UnreadLogBadge />
        </button>
        <span className="mx-1 h-3 w-px bg-border/80" aria-hidden="true" />
        <span className="flex h-6 items-center gap-1.5 px-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
          {t('app.offlineMode')}
        </span>
      </div>
    </footer>
  );
}
