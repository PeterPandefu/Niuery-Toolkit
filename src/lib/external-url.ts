import { openUrl } from '@tauri-apps/plugin-opener';

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function validateUrl(input: URL | string): URL {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('不支持打开此类型的链接');
  }
  return url;
}

export async function openExternalUrl(input: URL | string): Promise<void> {
  const url = validateUrl(input);
  if (isTauriRuntime()) {
    await openUrl(url.toString());
    return;
  }

  const opened = window.open(url.toString(), '_blank', 'noopener,noreferrer');
  if (!opened) throw new Error('浏览器弹窗被阻止，请允许弹窗后重试');
}
