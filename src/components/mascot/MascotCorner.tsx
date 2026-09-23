import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

function useMinute() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      const next = new Date();
      setNow(next);
      const wait = 60000 - (next.getSeconds() * 1000 + next.getMilliseconds());
      timer = window.setTimeout(arm, wait);
    };
    const first = new Date();
    timer = window.setTimeout(arm, 60000 - (first.getSeconds() * 1000 + first.getMilliseconds()));
    return () => window.clearTimeout(timer);
  }, []);
  return now;
}

export function MascotCorner({ visible }: { visible: boolean }) {
  const { i18n } = useTranslation();
  const now = useMinute();
  const locale = (i18n.resolvedLanguage ?? i18n.language).startsWith('zh') ? 'zh-CN' : 'en';
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const date = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short' }).format(now);

  return (
    <div
      data-mascot-corner=""
      data-visible={visible ? 'true' : 'false'}
      aria-hidden={visible ? undefined : true}
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col items-center px-4 pt-4 transition-opacity duration-200',
        visible ? 'opacity-100' : 'opacity-0'
      )}
    >
      <time dateTime={now.toISOString()} className="font-heading text-4xl font-semibold leading-none tracking-[-0.04em] text-foreground tabular-nums">
        {time}
      </time>
      <span className="mt-4 h-px w-8 bg-border" aria-hidden="true" />
      <p className="mt-4 text-sm leading-5 text-foreground">{date}</p>
      <div aria-hidden="true" className="mt-8 flex flex-col items-center">
        <span className="h-12 w-px bg-border" />
        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary" />
      </div>
    </div>
  );
}
