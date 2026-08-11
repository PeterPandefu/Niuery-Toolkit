import { describe, expect, it, vi } from 'vitest';
import { openTranslatorWithText } from '@/lib/translation-navigation';
import { useAppStore } from '@/store/app-store';
import { useScreenshotOcrStore } from '@/store/screenshot-ocr-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';

const { show, unminimize, setFocus } = vi.hoisted(() => ({
  show: vi.fn(() => Promise.resolve()),
  unminimize: vi.fn(() => Promise.resolve()),
  setFocus: vi.fn(() => Promise.resolve()),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show, unminimize, setFocus }),
}));

describe('openTranslatorWithText', () => {
  it('将文本作为一次性翻译请求并切换到翻译工具，同时恢复最小化的主窗口', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    useScreenshotOcrStore.setState({ pendingTranslation: null });
    useToolLifecycleStore.setState({ activeTools: [] });
    useAppStore.setState({ activeToolId: null });

    openTranslatorWithText('  截图中的文字  ');

    expect(useScreenshotOcrStore.getState().pendingTranslation?.text).toBe('截图中的文字');
    expect(useAppStore.getState().activeToolId).toBe('translator');
    expect(useToolLifecycleStore.getState().activeTools).toContain('translator');
    await vi.waitFor(() => expect(setFocus).toHaveBeenCalledOnce());
    expect(show).toHaveBeenCalledOnce();
    expect(unminimize).toHaveBeenCalledOnce();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });
});
