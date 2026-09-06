import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Cloud, Monitor, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
import type { ToolDefinition } from '@/types/tool';
import { detectPlatformCapabilities, missingToolCapabilities } from '@/lib/platform-capabilities';

const CAPABILITY_KEYS = {
  file: 'file',
  clipboard: 'clipboard',
  screen: 'screen',
  microphone: 'microphone',
  systemAudio: 'systemAudio',
  nativeWindow: 'nativeWindow',
  system: 'system',
  localNetwork: 'localNetwork',
} as const;

export function ToolCapabilityNotice({ tool }: { tool: ToolDefinition }) {
  const { t } = useTranslation();
  const platform = useMemo(() => detectPlatformCapabilities(), []);
  const missing = missingToolCapabilities(tool.capabilities, platform);
  const desktopUnavailable = tool.capabilities.desktopOnly && platform.runtime !== 'tauri';
  const networkLabel = t(`capabilities.network.${tool.capabilities.network}`);
  const NetworkIcon = tool.capabilities.network === 'offline' ? WifiOff : tool.capabilities.network === 'network' ? Wifi : Cloud;

  return (
    <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5" aria-label={t('capabilities.summary')}>
      <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
        <NetworkIcon className="h-3 w-3" aria-hidden="true" />
        {networkLabel}
      </span>
      {tool.capabilities.desktopOnly && (
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
          <Monitor className="h-3 w-3" aria-hidden="true" />
          {t('capabilities.desktopOnly')}
        </span>
      )}
      {tool.capabilities.permissions.map((capability) => (
        <span key={capability} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
          {t(`capabilities.permissions.${CAPABILITY_KEYS[capability]}`)}
        </span>
      ))}
      {(desktopUnavailable || missing.length > 0) && (
        <span className="basis-full text-xs text-warning" role="status">
          {desktopUnavailable
            ? t('capabilities.desktopRequired')
            : t('capabilities.missing', { items: missing.map((item) => t(`capabilities.permissions.${CAPABILITY_KEYS[item]}`)).join('、') })}
        </span>
      )}
    </div>
  );
}
