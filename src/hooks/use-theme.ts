import { useEffect, useSyncExternalStore } from 'react';
import { applyThemeTokens, getMonacoThemeName, getThemeTokens, type ThemeScheme } from '@/lib/theme';
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
  const scheme = useResolvedTheme();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.skin = skin;
    root.classList.toggle('dark', scheme === 'dark');
    applyThemeTokens(root, getThemeTokens(skin, scheme));
  }, [skin, scheme]);
}

export function useTheme() {
  const theme = useAppStore((state) => state.theme);
  const setTheme = useAppStore((state) => state.setTheme);
  const skin = useAppStore((state) => state.skin);
  const setSkin = useAppStore((state) => state.setSkin);
  const resetAppearance = useAppStore((state) => state.resetAppearance);
  const scheme = useResolvedTheme();

  return {
    theme,
    setTheme,
    skin,
    setSkin,
    resetAppearance,
    scheme,
    monacoTheme: getMonacoThemeName(skin, scheme),
  };
}

export function useIsDark() {
  return useResolvedTheme() === 'dark';
}
