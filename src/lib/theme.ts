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

// forge 保留为默认 ID，保障既有外观持久化数据兼容；视觉名称为“立春”。
const forgeLight: ThemeTokens = {
  background: '48 58% 97%', foreground: '21 48% 18%', card: '44 100% 99%', 'card-foreground': '21 48% 18%',
  popover: '44 100% 99%', 'popover-foreground': '21 48% 18%', primary: '13 82% 64%', 'primary-foreground': '21 48% 18%',
  secondary: '53 82% 93%', 'secondary-foreground': '28 39% 23%', muted: '49 44% 93%', 'muted-foreground': '25 22% 37%',
  accent: '154 32% 88%', 'accent-foreground': '152 28% 22%', destructive: '4 73% 44%', 'destructive-foreground': '0 0% 100%',
  success: '65 27% 35%', 'success-foreground': '44 100% 99%', warning: '50 78% 40%', 'warning-foreground': '21 48% 18%',
  info: '198 52% 36%', 'info-foreground': '0 0% 100%', border: '38 32% 84%', input: '37 28% 78%', ring: '9 48% 49%',
  sidebar: '48 54% 95%', 'sidebar-foreground': '21 43% 20%', 'sidebar-accent': '154 31% 88%', 'sidebar-border': '38 32% 84%',
  'surface-raised': '44 100% 99%', 'surface-overlay': '48 58% 98%', 'ember-glow': '13 82% 64%', 'shadow-tint': '22 29% 42%',
  'syntax-keyword': '265 49% 42%', 'syntax-string': '152 35% 30%', 'syntax-number': '11 57% 40%', 'syntax-title': '198 58% 33%',
  'syntax-type': '65 36% 28%', 'syntax-variable': '4 62% 40%', 'syntax-regexp': '329 56% 43%', 'syntax-meta': '25 18% 40%', radius: '0.75rem',
};

const forgeDark: ThemeTokens = {
  background: '22 36% 9%', foreground: '43 70% 94%', card: '22 29% 12%', 'card-foreground': '43 70% 94%',
  popover: '22 32% 11%', 'popover-foreground': '43 70% 94%', primary: '11 77% 77%', 'primary-foreground': '21 48% 18%',
  secondary: '23 19% 18%', 'secondary-foreground': '43 52% 89%', muted: '23 19% 18%', 'muted-foreground': '37 24% 70%',
  accent: '149 17% 18%', 'accent-foreground': '154 32% 88%', destructive: '9 81% 69%', 'destructive-foreground': '12 50% 13%',
  success: '78 33% 68%', 'success-foreground': '105 28% 13%', warning: '48 100% 72%', 'warning-foreground': '43 55% 13%',
  info: '197 69% 78%', 'info-foreground': '199 51% 14%', border: '22 17% 24%', input: '22 17% 29%', ring: '11 77% 77%',
  sidebar: '22 41% 7%', 'sidebar-foreground': '43 51% 89%', 'sidebar-accent': '22 24% 15%', 'sidebar-border': '22 19% 18%',
  'surface-raised': '22 25% 15%', 'surface-overlay': '22 32% 11%', 'ember-glow': '11 77% 77%', 'shadow-tint': '20 46% 3%',
  'syntax-keyword': '267 82% 81%', 'syntax-string': '151 45% 72%', 'syntax-number': '20 91% 74%', 'syntax-title': '196 77% 76%',
  'syntax-type': '65 65% 71%', 'syntax-variable': '5 84% 76%', 'syntax-regexp': '330 78% 79%', 'syntax-meta': '35 20% 71%', radius: '0.75rem',
};

const oceanLight: ThemeTokens = {
  background: '192 42% 97%', foreground: '190 48% 18%', card: '180 42% 100%', 'card-foreground': '190 48% 18%',
  popover: '180 42% 100%', 'popover-foreground': '190 48% 18%', primary: '191 58% 36%', 'primary-foreground': '180 42% 99%',
  secondary: '190 28% 92%', 'secondary-foreground': '191 38% 24%', muted: '190 28% 92%', 'muted-foreground': '193 18% 38%',
  accent: '181 42% 88%', 'accent-foreground': '190 48% 22%', destructive: '0 69% 43%', 'destructive-foreground': '0 0% 100%',
  success: '157 49% 30%', 'success-foreground': '0 0% 100%', warning: '39 82% 38%', 'warning-foreground': '38 55% 8%',
  info: '207 72% 38%', 'info-foreground': '0 0% 100%', border: '190 20% 83%', input: '190 20% 77%', ring: '191 58% 36%',
  sidebar: '190 34% 94%', 'sidebar-foreground': '190 42% 22%', 'sidebar-accent': '181 34% 87%', 'sidebar-border': '190 20% 83%',
  'surface-raised': '180 42% 100%', 'surface-overlay': '192 42% 98%', 'ember-glow': '191 58% 36%', 'shadow-tint': '193 26% 43%',
  'syntax-keyword': '238 51% 43%', 'syntax-string': '158 54% 29%', 'syntax-number': '191 58% 36%', 'syntax-title': '207 65% 36%',
  'syntax-type': '184 55% 29%', 'syntax-variable': '340 55% 42%', 'syntax-regexp': '281 48% 43%', 'syntax-meta': '194 16% 39%', radius: '0.75rem',
};

const oceanDark: ThemeTokens = {
  background: '195 36% 8%', foreground: '183 38% 93%', card: '195 30% 11%', 'card-foreground': '183 38% 93%',
  popover: '195 34% 10%', 'popover-foreground': '183 38% 93%', primary: '190 66% 73%', 'primary-foreground': '192 48% 15%',
  secondary: '194 20% 17%', 'secondary-foreground': '183 29% 88%', muted: '194 20% 17%', 'muted-foreground': '192 16% 68%',
  accent: '183 25% 17%', 'accent-foreground': '181 43% 89%', destructive: '0 78% 69%', 'destructive-foreground': '0 0% 12%',
  success: '157 53% 61%', 'success-foreground': '156 42% 12%', warning: '42 94% 69%', 'warning-foreground': '42 45% 11%',
  info: '204 86% 75%', 'info-foreground': '205 48% 12%', border: '195 19% 23%', input: '195 19% 28%', ring: '190 66% 73%',
  sidebar: '195 41% 6%', 'sidebar-foreground': '183 28% 89%', 'sidebar-accent': '191 24% 14%', 'sidebar-border': '195 20% 17%',
  'surface-raised': '195 27% 14%', 'surface-overlay': '195 34% 10%', 'ember-glow': '190 66% 73%', 'shadow-tint': '195 43% 3%',
  'syntax-keyword': '237 84% 81%', 'syntax-string': '159 60% 70%', 'syntax-number': '190 75% 74%', 'syntax-title': '204 83% 78%',
  'syntax-type': '183 65% 69%', 'syntax-variable': '339 75% 79%', 'syntax-regexp': '281 70% 81%', 'syntax-meta': '194 19% 72%', radius: '0.75rem',
};

const forestLight: ThemeTokens = {
  background: '95 25% 97%', foreground: '139 28% 18%', card: '92 30% 100%', 'card-foreground': '139 28% 18%',
  popover: '92 30% 100%', 'popover-foreground': '139 28% 18%', primary: '140 27% 36%', 'primary-foreground': '95 30% 99%',
  secondary: '101 19% 92%', 'secondary-foreground': '139 24% 23%', muted: '101 19% 92%', 'muted-foreground': '134 12% 38%',
  accent: '111 29% 89%', 'accent-foreground': '140 28% 24%', destructive: '0 68% 43%', 'destructive-foreground': '0 0% 100%',
  success: '144 39% 30%', 'success-foreground': '0 0% 100%', warning: '41 78% 37%', 'warning-foreground': '40 53% 8%',
  info: '202 67% 37%', 'info-foreground': '0 0% 100%', border: '107 16% 83%', input: '107 16% 77%', ring: '140 27% 36%',
  sidebar: '103 22% 94%', 'sidebar-foreground': '139 25% 21%', 'sidebar-accent': '111 24% 87%', 'sidebar-border': '107 16% 83%',
  'surface-raised': '92 30% 100%', 'surface-overlay': '95 25% 98%', 'ember-glow': '140 27% 36%', 'shadow-tint': '134 18% 39%',
  'syntax-keyword': '268 48% 43%', 'syntax-string': '144 46% 29%', 'syntax-number': '34 67% 36%', 'syntax-title': '194 57% 35%',
  'syntax-type': '140 39% 28%', 'syntax-variable': '350 53% 42%', 'syntax-regexp': '304 46% 43%', 'syntax-meta': '136 12% 39%', radius: '0.5rem',
};

const forestDark: ThemeTokens = {
  background: '142 22% 8%', foreground: '102 30% 93%', card: '142 18% 11%', 'card-foreground': '102 30% 93%',
  popover: '142 20% 10%', 'popover-foreground': '102 30% 93%', primary: '106 39% 74%', 'primary-foreground': '139 32% 15%',
  secondary: '142 15% 17%', 'secondary-foreground': '102 23% 88%', muted: '142 15% 17%', 'muted-foreground': '115 12% 68%',
  accent: '141 22% 17%', 'accent-foreground': '108 35% 89%', destructive: '0 77% 69%', 'destructive-foreground': '0 0% 11%',
  success: '144 48% 62%', 'success-foreground': '144 37% 12%', warning: '43 91% 69%', 'warning-foreground': '43 42% 11%',
  info: '200 81% 75%', 'info-foreground': '201 43% 12%', border: '142 15% 23%', input: '142 15% 28%', ring: '106 39% 74%',
  sidebar: '142 27% 6%', 'sidebar-foreground': '104 22% 89%', 'sidebar-accent': '142 17% 14%', 'sidebar-border': '142 16% 17%',
  'surface-raised': '142 17% 14%', 'surface-overlay': '142 20% 10%', 'ember-glow': '106 39% 74%', 'shadow-tint': '142 29% 3%',
  'syntax-keyword': '269 75% 80%', 'syntax-string': '144 56% 70%', 'syntax-number': '42 80% 72%', 'syntax-title': '196 74% 76%',
  'syntax-type': '143 53% 69%', 'syntax-variable': '351 73% 78%', 'syntax-regexp': '304 64% 79%', 'syntax-meta': '111 14% 72%', radius: '0.5rem',
};

const monoLight: ThemeTokens = {
  background: '0 0% 98%', foreground: '0 0% 10%', card: '0 0% 100%', 'card-foreground': '0 0% 10%',
  popover: '0 0% 100%', 'popover-foreground': '0 0% 10%', primary: '0 0% 18%', 'primary-foreground': '0 0% 100%',
  secondary: '0 0% 92%', 'secondary-foreground': '0 0% 16%', muted: '0 0% 92%', 'muted-foreground': '0 0% 38%',
  accent: '0 0% 90%', 'accent-foreground': '0 0% 15%', destructive: '0 72% 42%', 'destructive-foreground': '0 0% 100%',
  success: '153 63% 30%', 'success-foreground': '0 0% 100%', warning: '36 92% 38%', 'warning-foreground': '33 25% 9%',
  info: '214 82% 38%', 'info-foreground': '0 0% 100%', border: '0 0% 84%', input: '0 0% 78%', ring: '0 0% 18%',
  sidebar: '0 0% 94%', 'sidebar-foreground': '0 0% 16%', 'sidebar-accent': '0 0% 88%', 'sidebar-border': '0 0% 84%',
  'surface-raised': '0 0% 100%', 'surface-overlay': '0 0% 98%', 'ember-glow': '0 0% 18%', 'shadow-tint': '0 0% 35%',
  'syntax-keyword': '245 58% 40%', 'syntax-string': '142 52% 28%', 'syntax-number': '28 78% 35%', 'syntax-title': '211 72% 38%',
  'syntax-type': '39 77% 31%', 'syntax-variable': '346 62% 39%', 'syntax-regexp': '291 51% 40%', 'syntax-meta': '0 0% 38%', radius: '0.25rem',
};

const monoDark: ThemeTokens = {
  background: '0 0% 6%', foreground: '0 0% 94%', card: '0 0% 9%', 'card-foreground': '0 0% 94%',
  popover: '0 0% 8%', 'popover-foreground': '0 0% 94%', primary: '0 0% 86%', 'primary-foreground': '0 0% 10%',
  secondary: '0 0% 15%', 'secondary-foreground': '0 0% 88%', muted: '0 0% 15%', 'muted-foreground': '0 0% 70%',
  accent: '0 0% 18%', 'accent-foreground': '0 0% 92%', destructive: '0 78% 64%', 'destructive-foreground': '0 0% 10%',
  success: '153 62% 54%', 'success-foreground': '153 35% 10%', warning: '40 95% 62%', 'warning-foreground': '40 35% 10%',
  info: '214 90% 68%', 'info-foreground': '214 40% 10%', border: '0 0% 22%', input: '0 0% 27%', ring: '0 0% 86%',
  sidebar: '0 0% 5%', 'sidebar-foreground': '0 0% 88%', 'sidebar-accent': '0 0% 12%', 'sidebar-border': '0 0% 16%',
  'surface-raised': '0 0% 12%', 'surface-overlay': '0 0% 8%', 'ember-glow': '0 0% 86%', 'shadow-tint': '0 0% 2%',
  'syntax-keyword': '246 92% 80%', 'syntax-string': '144 66% 66%', 'syntax-number': '35 94% 69%', 'syntax-title': '211 94% 74%',
  'syntax-type': '46 95% 69%', 'syntax-variable': '347 87% 77%', 'syntax-regexp': '293 83% 78%', 'syntax-meta': '0 0% 72%', radius: '0.25rem',
};

export const SKINS: Record<SkinId, SkinDefinition> = {
  forge: { id: 'forge', light: forgeLight, dark: forgeDark },
  ocean: { id: 'ocean', light: oceanLight, dark: oceanDark },
  forest: { id: 'forest', light: forestLight, dark: forestDark },
  mono: { id: 'mono', light: monoLight, dark: monoDark },
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
