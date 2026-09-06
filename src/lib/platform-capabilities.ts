import type { ToolCapabilityId, ToolCapabilities } from '@/types/tool';

export type RuntimePlatform = 'tauri' | 'browser';

export interface PlatformCapabilities {
  runtime: RuntimePlatform;
  file: boolean;
  screen: boolean;
  microphone: boolean;
  systemAudio: boolean;
  clipboard: boolean;
  nativeWindow: boolean;
  system: boolean;
  localNetwork: boolean;
}

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function detectPlatformCapabilities(): PlatformCapabilities {
  const runtime = isTauriRuntime() ? 'tauri' : 'browser';
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  return {
    runtime,
    file: true,
    screen: Boolean(mediaDevices?.getDisplayMedia),
    microphone: Boolean(mediaDevices?.getUserMedia),
    // Web browsers can request system audio only as part of a display capture prompt;
    // the desktop recorder exposes a separate native source selector.
    systemAudio: runtime === 'tauri',
    clipboard: Boolean(typeof navigator !== 'undefined' && navigator.clipboard),
    nativeWindow: runtime === 'tauri',
    system: runtime === 'tauri',
    localNetwork: runtime === 'tauri',
  };
}

export function missingToolCapabilities(
  tool: ToolCapabilities,
  platform = detectPlatformCapabilities()
): ToolCapabilityId[] {
  return tool.permissions.filter((capability) => !platform[capability]);
}
