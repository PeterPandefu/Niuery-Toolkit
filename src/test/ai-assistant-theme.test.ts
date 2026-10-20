import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getThemeTokens, SKIN_IDS } from '@/lib/theme';

const aiStyles = readFileSync(resolve(process.cwd(), 'src/tools/ai-assistant/ai-assistant.css'), 'utf8');

describe('AI assistant surface theme mapping', () => {
  it('uses the shared sidebar and raised surface tokens for its major panels', () => {
    expect(aiStyles).toMatch(/\.ai-sidebar\s*\{[^}]*background:hsl\(var\(--sidebar\)\)/s);
    expect(aiStyles).toMatch(/\.ai-message-user \.ai-message-body\s*\{[^}]*background:hsl\(var\(--surface-overlay\)\)/s);
    expect(aiStyles).toMatch(/\.ai-composer\s*\{[^}]*background:hsl\(var\(--surface-raised\)\)/s);
  });

  it.each(SKIN_IDS)('defines those shared surface tokens for %s in both schemes', skin => {
    for (const scheme of ['light', 'dark'] as const) {
      const tokens = getThemeTokens(skin, scheme);
      expect(tokens.sidebar).toBeTruthy();
      expect(tokens['surface-overlay']).toBeTruthy();
      expect(tokens['surface-raised']).toBeTruthy();
    }
  });
});
