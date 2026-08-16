import { useState } from 'react';
import { ExternalLink, Keyboard, StickyNote as StickyNoteIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/lib/api-client';

export default function StickyNoteTool() {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const openStickyNote = () => {
    if (!isTauri) return;
    setError(null);
    void invoke('show_sticky_note_window').catch(() => {
      setError(t('stickyNoteLauncher.openFailed'));
    });
  };

  return (
    <section className="mx-auto flex h-full max-w-3xl items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-7 shadow-tinted-sm">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <StickyNoteIcon className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">{t('stickyNote.title')}</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('stickyNoteLauncher.description')}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={openStickyNote}
            disabled={!isTauri}
            className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t('stickyNoteLauncher.open')}
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-2 font-mono text-xs text-muted-foreground">
            <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
            Ctrl + Alt + N
          </span>
        </div>

        {!isTauri && <p className="mt-4 text-xs text-muted-foreground">{t('stickyNoteLauncher.desktopOnly')}</p>}
        {error && <p className="mt-4 text-sm text-destructive" role="alert">{error}</p>}
      </div>
    </section>
  );
}
