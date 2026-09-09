import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Minus, Square, X } from 'lucide-react';
import { isTauri } from '@/lib/api-client';
import { cn } from '@/lib/utils';

async function withMainWindow(action: (window: { minimize: () => Promise<void>; toggleMaximize: () => Promise<void>; close: () => Promise<void>; isMaximized: () => Promise<boolean> }) => Promise<void>) {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await action(getCurrentWindow());
}

/** 无边框窗口的系统按钮，嵌在内容顶栏右侧，避免侧栏上方出现色条。 */
export function WindowControls() {
  const { t } = useTranslation();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const current = getCurrentWindow();
      const nextMaximized = await current.isMaximized();
      if (!disposed) setMaximized(nextMaximized);
      unlisten = await current.onResized(async () => {
        const resizedMaximized = await current.isMaximized();
        if (!disposed) setMaximized(resizedMaximized);
      });
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  if (!isTauri) return null;

  return (
    <div className="flex h-8 shrink-0 items-center">
      <TitleButton
        label={t('app.windowMinimize')}
        onClick={() => { void withMainWindow((window) => window.minimize()); }}
      >
        <Minus className="h-3.5 w-3.5" />
      </TitleButton>
      <TitleButton
        label={maximized ? t('app.windowRestore') : t('app.windowMaximize')}
        onClick={() => { void withMainWindow((window) => window.toggleMaximize()); }}
      >
        <Square className={cn('h-3 w-3', maximized && 'p-px')} />
      </TitleButton>
      <TitleButton
        label={t('app.windowClose')}
        danger
        onClick={() => { void withMainWindow((window) => window.close()); }}
      >
        <X className="h-3.5 w-3.5" />
      </TitleButton>
    </div>
  );
}

function TitleButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-8 w-11 items-center justify-center text-muted-foreground transition-colors',
        danger ? 'hover:bg-destructive hover:text-destructive-foreground' : 'hover:bg-accent hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}
