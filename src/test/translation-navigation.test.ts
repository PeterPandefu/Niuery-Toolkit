import { describe, expect, it } from 'vitest';
import { openTranslatorWithText } from '@/lib/translation-navigation';
import { useAppStore } from '@/store/app-store';
import { useScreenshotOcrStore } from '@/store/screenshot-ocr-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';

describe('openTranslatorWithText', () => {
  it('将文本作为一次性翻译请求并切换到翻译工具', () => {
    useScreenshotOcrStore.setState({ pendingTranslation: null });
    useToolLifecycleStore.setState({ activeTools: [] });
    useAppStore.setState({ activeToolId: null });

    openTranslatorWithText('  截图中的文字  ');

    expect(useScreenshotOcrStore.getState().pendingTranslation?.text).toBe('截图中的文字');
    expect(useAppStore.getState().activeToolId).toBe('translator');
    expect(useToolLifecycleStore.getState().activeTools).toContain('translator');
  });
});
