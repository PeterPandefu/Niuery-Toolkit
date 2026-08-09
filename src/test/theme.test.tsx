import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getContrastRatio, getMonacoThemeName, getThemeTokens, registerMonacoThemes, SKIN_IDS } from '@/lib/theme';
import { useApplyTheme } from '@/hooks/use-theme';
import { useAppStore } from '@/store/app-store';

let systemIsDark = false;
let systemListener: ((event: MediaQueryListEvent) => void) | undefined;

function ThemeHarness() {
  useApplyTheme();
  return null;
}

describe('主题系统', () => {
  beforeEach(() => {
    systemIsDark = false;
    systemListener = undefined;
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation(() => ({
      matches: systemIsDark,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => { systemListener = listener; },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    useAppStore.setState({ theme: 'system', skin: 'forge' });
    document.documentElement.removeAttribute('data-skin');
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('应用皮肤，并在系统偏好变化时更新亮暗方案', async () => {
    render(<ThemeHarness />);
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe('forge'));

    act(() => useAppStore.getState().setSkin('ocean'));
    await waitFor(() => expect(document.documentElement.dataset.skin).toBe('ocean'));
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(getThemeTokens('ocean', 'light').primary);

    systemIsDark = true;
    act(() => systemListener?.({ matches: true } as MediaQueryListEvent));
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe(getThemeTokens('ocean', 'dark').primary);
  });

  it('所有皮肤的关键文本组合均满足 WCAG AA', () => {
    SKIN_IDS.forEach((skin) => {
      (['light', 'dark'] as const).forEach((scheme) => {
        const tokens = getThemeTokens(skin, scheme);
        const pairs: [string, string][] = [
          [tokens.foreground, tokens.background],
          [tokens['card-foreground'], tokens.card],
          [tokens['primary-foreground'], tokens.primary],
          [tokens['destructive-foreground'], tokens.destructive],
          [tokens['success-foreground'], tokens.success],
          [tokens['warning-foreground'], tokens.warning],
          [tokens['info-foreground'], tokens.info],
        ];
        pairs.forEach(([foreground, background]) => {
          expect(getContrastRatio(foreground, background), `${skin}/${scheme}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
        });
      });
    });
  });

  it('为每个皮肤的亮暗方案注册 Monaco 主题', () => {
    const defineTheme = vi.fn();
    registerMonacoThemes({ editor: { defineTheme } } as never);

    expect(defineTheme).toHaveBeenCalledTimes(8);
    expect(defineTheme).toHaveBeenCalledWith(getMonacoThemeName('ocean', 'dark'), expect.objectContaining({ base: 'vs-dark' }));
    expect(defineTheme).toHaveBeenCalledWith(getMonacoThemeName('forest', 'light'), expect.objectContaining({ base: 'vs' }));
  });
});
