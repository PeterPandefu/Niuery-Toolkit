import { useEffect, useSyncExternalStore } from 'react';
import { applyThemeTokens, getMonacoThemeName, getThemeTokens, toHex, type ThemeScheme } from '@/lib/theme';
import { DEFAULT_ATMOSPHERE } from '@/lib/atmosphere';
import { DEFAULT_POINTER_EFFECT } from '@/lib/pointer-effect';
import { isTauri } from '@/lib/api-client';
import { useAppStore } from '@/store/app-store';

const darkSchemeQuery = '(prefers-color-scheme: dark)';

function subscribeToSystemTheme(callback: () => void) {
  const mediaQuery = window.matchMedia(darkSchemeQuery);
  mediaQuery.addEventListener('change', callback);
  return () => mediaQuery.removeEventListener('change', callback);
}

function getSystemThemeSnapshot() {
  return window.matchMedia(darkSchemeQuery).matches;
}

function getServerThemeSnapshot() {
  return false;
}

/** 获取会随操作系统偏好实时更新的最终亮暗方案。 */
export function useResolvedTheme(): ThemeScheme {
  const theme = useAppStore((state) => state.theme);
  const systemIsDark = useSyncExternalStore(subscribeToSystemTheme, getSystemThemeSnapshot, getServerThemeSnapshot);
  return theme === 'system' ? (systemIsDark ? 'dark' : 'light') : theme;
}

/** 仅在应用根部调用：把当前外观写入 DOM。 */
export function useApplyTheme() {
  const skin = useAppStore((state) => state.skin);
  const atmosphere = useAppStore((state) => state.atmosphere);
  const scheme = useResolvedTheme();

  useEffect(() => {
    const root = document.documentElement;
    const tokens = getThemeTokens(skin, scheme);
    root.dataset.skin = skin;
    root.dataset.atmosphere = atmosphere ?? DEFAULT_ATMOSPHERE;
    root.classList.toggle('dark', scheme === 'dark');
    applyThemeTokens(root, tokens);

    if (!isTauri) return;
    void import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('set_window_chrome', {
        background: toHex(tokens.background),
        foreground: toHex(tokens.foreground),
        dark: scheme === 'dark',
      }).catch(() => undefined);
    });
  }, [skin, atmosphere, scheme]);
}

export function useTheme() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const skin = useAppStore((state) => state.skin);
  const setSkin = useAppStore((state) => state.setSkin);
  const atmosphere = useAppStore((state) => state.atmosphere);
  const setAtmosphere = useAppStore((state) => state.setAtmosphere);
  const pointerEffect = useAppStore((state) => state.pointerEffect) ?? DEFAULT_POINTER_EFFECT;
  const setPointerEffect = useAppStore((state) => state.setPointerEffect);
  const mascotEnabled = useAppStore((state) => state.mascotEnabled) !== false;
  const setMascotEnabled = useAppStore((state) => state.setMascotEnabled);
  const resetAppearance = useAppStore((state) => state.resetAppearance);
  const scheme = useResolvedTheme();

  return {
    theme,
    setTheme,
    skin,
    setSkin,
    atmosphere,
    setAtmosphere,
    pointerEffect,
    setPointerEffect,
    mascotEnabled,
    setMascotEnabled,
    resetAppearance,
    scheme,
    monacoTheme: getMonacoThemeName(skin, scheme),
  };
}

export function useIsDark() {
  return useResolvedTheme() === 'dark';
}
