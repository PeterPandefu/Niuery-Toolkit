import type * as Monaco from 'monaco-editor';
import type { SkinId } from '@/types/tool';

export type ThemeScheme = 'light' | 'dark';

export interface ThemeTokens {
  background: string;
  foreground: string;
  card: string;
  'card-foreground': string;
  popover: string;
  'popover-foreground': string;
  primary: string;
  'primary-foreground': string;
  secondary: string;
  'secondary-foreground': string;
  muted: string;
  'muted-foreground': string;
  accent: string;
  'accent-foreground': string;
  destructive: string;
  'destructive-foreground': string;
  success: string;
  'success-foreground': string;
  warning: string;
  'warning-foreground': string;
  info: string;
  'info-foreground': string;
  border: string;
  input: string;
  ring: string;
  sidebar: string;
  'sidebar-foreground': string;
  'sidebar-accent': string;
  'sidebar-border': string;
  'surface-raised': string;
  'surface-overlay': string;
  'ember-glow': string;
  'shadow-tint': string;
  'syntax-keyword': string;
  'syntax-string': string;
  'syntax-number': string;
  'syntax-title': string;
  'syntax-type': string;
  'syntax-variable': string;
  'syntax-regexp': string;
  'syntax-meta': string;
  radius: string;
}

export interface SkinDefinition {
  id: SkinId;
  light: ThemeTokens;
  dark: ThemeTokens;
}

const forgeLight: ThemeTokens = {
  background: '33 26% 97%', foreground: '20 16% 13%', card: '33 30% 99%', 'card-foreground': '20 16% 13%',
  popover: '33 26% 98%', 'popover-foreground': '20 16% 13%', primary: '24 82% 40%', 'primary-foreground': '30 30% 98%',
  secondary: '30 16% 92%', 'secondary-foreground': '20 14% 20%', muted: '30 16% 92%', 'muted-foreground': '24 8% 38%',
  accent: '28 45% 92%', 'accent-foreground': '22 35% 20%', destructive: '0 72% 42%', 'destructive-foreground': '0 0% 98%',
  success: '153 63% 30%', 'success-foreground': '0 0% 100%', warning: '36 92% 38%', 'warning-foreground': '33 25% 9%',
  info: '214 82% 38%', 'info-foreground': '0 0% 100%', border: '30 13% 84%', input: '30 13% 78%', ring: '24 82% 40%',
  sidebar: '30 20% 94%', 'sidebar-foreground': '20 12% 26%', 'sidebar-accent': '28 26% 88%', 'sidebar-border': '30 15% 84%',
  'surface-raised': '33 30% 99%', 'surface-overlay': '33 26% 98%', 'ember-glow': '24 82% 40%', 'shadow-tint': '30 20% 50%',
  'syntax-keyword': '262 60% 37%', 'syntax-string': '158 62% 28%', 'syntax-number': '27 82% 35%', 'syntax-title': '215 75% 38%',
  'syntax-type': '36 80% 33%', 'syntax-variable': '0 68% 40%', 'syntax-regexp': '330 63% 40%', 'syntax-meta': '215 15% 36%', radius: '0.625rem',
};

const forgeDark: ThemeTokens = {
  background: '20 14% 7%', foreground: '32 22% 92%', card: '20 13% 9.5%', 'card-foreground': '32 22% 92%',
  popover: '20 14% 8.5%', 'popover-foreground': '32 22% 92%', primary: '27 88% 60%', 'primary-foreground': '24 30% 9%',
  secondary: '20 11% 14%', 'secondary-foreground': '32 18% 88%', muted: '20 11% 14%', 'muted-foreground': '26 9% 65%',
  accent: '24 32% 15%', 'accent-foreground': '30 45% 90%', destructive: '0 78% 64%', 'destructive-foreground': '0 0% 10%',
  success: '153 62% 54%', 'success-foreground': '153 35% 10%', warning: '40 95% 62%', 'warning-foreground': '40 35% 10%',
  info: '214 90% 68%', 'info-foreground': '214 40% 10%', border: '20 11% 18%', input: '20 11% 22%', ring: '27 88% 60%',
  sidebar: '20 15% 5.5%', 'sidebar-foreground': '30 15% 88%', 'sidebar-accent': '22 20% 12%', 'sidebar-border': '20 12% 15%',
  'surface-raised': '20 13% 11%', 'surface-overlay': '20 14% 9%', 'ember-glow': '27 88% 60%', 'shadow-tint': '20 30% 3%',
  'syntax-keyword': '267 91% 78%', 'syntax-string': '157 66% 65%', 'syntax-number': '31 95% 68%', 'syntax-title': '211 95% 72%',
  'syntax-type': '45 96% 68%', 'syntax-variable': '0 86% 73%', 'syntax-regexp': '329 89% 75%', 'syntax-meta': '215 18% 70%', radius: '0.625rem',
};

function withPalette(base: ThemeTokens, overrides: Partial<ThemeTokens>): ThemeTokens {
  return { ...base, ...overrides };
}

export const SKINS: Record<SkinId, SkinDefinition> = {
  forge: { id: 'forge', light: forgeLight, dark: forgeDark },
  ocean: {
    id: 'ocean',
    light: withPalette(forgeLight, { background: '200 38% 97%', card: '198 42% 99%', popover: '200 38% 98%', primary: '198 82% 36%', ring: '198 82% 36%', accent: '194 48% 91%', sidebar: '198 30% 94%', 'sidebar-accent': '195 30% 88%', 'ember-glow': '198 82% 36%', 'shadow-tint': '200 28% 48%', 'syntax-keyword': '234 57% 42%', 'syntax-string': '174 67% 28%', 'syntax-number': '198 82% 36%', 'syntax-title': '211 80% 38%', 'syntax-type': '189 75% 30%', 'syntax-variable': '340 64% 40%', 'syntax-regexp': '282 58% 42%', 'syntax-meta': '205 18% 38%', radius: '0.75rem' }),
    dark: withPalette(forgeDark, { background: '204 30% 7%', card: '204 27% 10%', popover: '204 30% 9%', primary: '190 86% 58%', ring: '190 86% 58%', accent: '197 31% 16%', sidebar: '204 33% 5%', 'sidebar-accent': '200 24% 13%', 'ember-glow': '190 86% 58%', 'shadow-tint': '206 38% 3%', 'syntax-keyword': '235 91% 78%', 'syntax-string': '174 72% 64%', 'syntax-number': '190 92% 67%', 'syntax-title': '205 94% 73%', 'syntax-type': '184 77% 65%', 'syntax-variable': '339 86% 75%', 'syntax-regexp': '281 84% 77%', 'syntax-meta': '205 20% 72%', radius: '0.75rem' }),
  },
  forest: {
    id: 'forest',
    light: withPalette(forgeLight, { background: '126 24% 97%', card: '120 27% 99%', popover: '126 24% 98%', primary: '152 63% 30%', ring: '152 63% 30%', accent: '145 35% 91%', sidebar: '130 20% 94%', 'sidebar-accent': '142 23% 88%', 'ember-glow': '152 63% 30%', 'shadow-tint': '145 22% 44%', 'syntax-keyword': '266 55% 40%', 'syntax-string': '151 66% 27%', 'syntax-number': '35 82% 34%', 'syntax-title': '192 76% 34%', 'syntax-type': '147 60% 27%', 'syntax-variable': '350 63% 40%', 'syntax-regexp': '304 55% 40%', 'syntax-meta': '151 14% 34%', radius: '0.5rem' }),
    dark: withPalette(forgeDark, { background: '145 20% 7%', card: '145 18% 10%', popover: '145 20% 9%', primary: '150 65% 52%', ring: '150 65% 52%', accent: '148 25% 15%', sidebar: '145 24% 5%', 'sidebar-accent': '145 18% 12%', 'ember-glow': '150 65% 52%', 'shadow-tint': '145 28% 3%', 'syntax-keyword': '270 83% 77%', 'syntax-string': '151 66% 63%', 'syntax-number': '42 91% 67%', 'syntax-title': '192 83% 69%', 'syntax-type': '147 64% 63%', 'syntax-variable': '351 84% 74%', 'syntax-regexp': '304 73% 75%', 'syntax-meta': '150 16% 70%', radius: '0.5rem' }),
  },
  mono: {
    id: 'mono',
    light: withPalette(forgeLight, { background: '0 0% 98%', foreground: '0 0% 10%', card: '0 0% 100%', popover: '0 0% 100%', primary: '0 0% 18%', ring: '0 0% 18%', secondary: '0 0% 92%', muted: '0 0% 92%', accent: '0 0% 90%', sidebar: '0 0% 94%', 'sidebar-accent': '0 0% 88%', 'ember-glow': '0 0% 18%', 'shadow-tint': '0 0% 35%', 'syntax-keyword': '245 58% 40%', 'syntax-string': '142 52% 28%', 'syntax-number': '28 78% 35%', 'syntax-title': '211 72% 38%', 'syntax-type': '39 77% 31%', 'syntax-variable': '346 62% 39%', 'syntax-regexp': '291 51% 40%', 'syntax-meta': '0 0% 38%', radius: '0.25rem' }),
    dark: withPalette(forgeDark, { background: '0 0% 6%', foreground: '0 0% 94%', card: '0 0% 9%', popover: '0 0% 8%', primary: '0 0% 86%', 'primary-foreground': '0 0% 10%', ring: '0 0% 86%', secondary: '0 0% 15%', muted: '0 0% 15%', accent: '0 0% 18%', sidebar: '0 0% 5%', 'sidebar-accent': '0 0% 12%', 'ember-glow': '0 0% 86%', 'shadow-tint': '0 0% 2%', 'syntax-keyword': '246 92% 80%', 'syntax-string': '144 66% 66%', 'syntax-number': '35 94% 69%', 'syntax-title': '211 94% 74%', 'syntax-type': '46 95% 69%', 'syntax-variable': '347 87% 77%', 'syntax-regexp': '293 83% 78%', 'syntax-meta': '0 0% 72%', radius: '0.25rem' }),
  },
};

export const SKIN_IDS: SkinId[] = ['forge', 'ocean', 'forest', 'mono'];
export const DEFAULT_SKIN: SkinId = 'forge';

export function getThemeTokens(skin: SkinId, scheme: ThemeScheme): ThemeTokens {
  return SKINS[skin][scheme];
}

export function applyThemeTokens(root: HTMLElement, tokens: ThemeTokens) {
  Object.entries(tokens).forEach(([name, value]) => root.style.setProperty(`--${name}`, value));
}

function hslToRgb(hsl: string): [number, number, number] {
  const [h, s, l] = hsl.split(/\s+/).map((value) => Number.parseFloat(value));
  const saturation = s / 100;
  const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lightness - chroma / 2;
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return [r, g, b].map((value) => Math.round((value + m) * 255)) as [number, number, number];
}

function toHex(hsl: string): string {
  return `#${hslToRgb(hsl).map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function rgbaHex(hsl: string, alpha: string): string {
  return `${toHex(hsl)}${alpha}`;
}

export function getMonacoThemeName(skin: SkinId, scheme: ThemeScheme) {
  return `niuery-${skin}-${scheme}`;
}

export function registerMonacoThemes(monaco: typeof Monaco) {
  SKIN_IDS.forEach((skin) => {
    (['light', 'dark'] as ThemeScheme[]).forEach((scheme) => {
      const tokens = getThemeTokens(skin, scheme);
      monaco.editor.defineTheme(getMonacoThemeName(skin, scheme), {
        base: scheme === 'dark' ? 'vs-dark' : 'vs',
        inherit: true,
        colors: {
          'editor.background': toHex(tokens.background),
          'editor.foreground': toHex(tokens.foreground),
          'editor.lineHighlightBackground': rgbaHex(tokens.accent, '70'),
          'editor.selectionBackground': rgbaHex(tokens.primary, '38'),
          'editor.inactiveSelectionBackground': rgbaHex(tokens.primary, '24'),
          'editorCursor.foreground': toHex(tokens.primary),
          'editorLineNumber.foreground': toHex(tokens['muted-foreground']),
          'editorLineNumber.activeForeground': toHex(tokens.foreground),
          'editorGutter.background': toHex(tokens.background),
          'editorIndentGuide.background1': rgbaHex(tokens.border, '8c'),
          'editorIndentGuide.activeBackground1': toHex(tokens.border),
          'editorWidget.background': toHex(tokens.popover),
          'editorWidget.border': toHex(tokens.border),
          'diffEditor.insertedTextBackground': rgbaHex(tokens.success, '38'),
          'diffEditor.removedTextBackground': rgbaHex(tokens.destructive, '38'),
        },
        rules: [
          { token: 'keyword', foreground: toHex(tokens['syntax-keyword']).slice(1) },
          { token: 'string', foreground: toHex(tokens['syntax-string']).slice(1) },
          { token: 'number', foreground: toHex(tokens['syntax-number']).slice(1) },
          { token: 'type', foreground: toHex(tokens['syntax-type']).slice(1) },
          { token: 'identifier', foreground: toHex(tokens.foreground).slice(1) },
          { token: 'comment', foreground: toHex(tokens['syntax-meta']).slice(1), fontStyle: 'italic' },
          { token: 'regexp', foreground: toHex(tokens['syntax-regexp']).slice(1) },
        ],
      });
    });
  });
}

function relativeLuminance(hsl: string) {
  const channels = hslToRgb(hsl).map((value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function getContrastRatio(first: string, second: string) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}
