import { expect, test } from '@playwright/test';

const skins = ['forge', 'ocean', 'forest', 'mono'] as const;
const modes = ['light', 'dark'] as const;

for (const skin of skins) {
  for (const theme of modes) {
    test(`主题视觉回归：${skin}-${theme}`, async ({ page }) => {
      await page.addInitScript(({ initialSkin, initialTheme }) => {
        localStorage.setItem(
          'niuery-toolkit-store',
          JSON.stringify({
            state: {
              theme: initialTheme,
              skin: initialSkin,
              recentTools: [],
              pinnedTools: ['json-formatter', 'base64', 'timestamp', 'uuid-generator', 'qrcode', 'text-diff'],
            },
            version: 1,
          })
        );
      }, { initialSkin: skin, initialTheme: theme });

      await page.goto('/');
      await expect(page.locator('nav[aria-label="Category navigation"]')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-skin', skin);
      if (theme === 'dark') {
        await expect(page.locator('html')).toHaveClass(/dark/);
      } else {
        await expect(page.locator('html')).not.toHaveClass(/dark/);
      }
      await expect(page).toHaveScreenshot(`theme-${skin}-${theme}.png`, { animations: 'disabled', fullPage: true });
    });
  }
}
