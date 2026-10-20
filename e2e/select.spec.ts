import { expect, test, type Page } from '@playwright/test';

async function openTool(page: Page, toolId: string) {
  await page.locator('header button[title="Ctrl+K"]').click();
  await page.locator('[role=combobox][aria-controls=tool-search-results]').fill(toolId);
  await page.locator(`#tool-search-option-${toolId}`).click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('i18nextLng', 'zh');
    localStorage.setItem('niuery-toolkit-store', JSON.stringify({ state: { theme: 'light', skin: 'forge', sidebarCollapsed: true }, version: 1 }));
  });
  await page.goto('/');
});

test('各类工具共用下拉样式，键盘确认可更新业务值', async ({ page }) => {
  for (const toolId of ['angle', 'base64', 'json-formatter', 'sql-formatter', 'translator', 'api-tester']) {
    await openTool(page, toolId);
    const trigger = page.locator('.ui-select-trigger:visible').first();
    await expect(trigger).toBeVisible();
    await trigger.click();
    const list = page.getByRole('listbox');
    await expect(list).toBeVisible();
    const popup = page.locator('.ui-select-popover');
    await expect(popup).toHaveCSS('border-radius', '12px');
    const last = list.getByRole('option').last();
    const expectedLabel = await last.getAttribute('aria-label');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(list).toHaveCount(0);
    await expect(trigger).toContainText(expectedLabel!);
    await expect(trigger).toBeFocused();
  }
});

test('窄窗口中的长列表保持在窗口内', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openTool(page, 'translator');
  await page.getByRole('combobox', { name: '目标语言' }).click();
  const popup = page.locator('.ui-select-popover');
  await expect(popup).toBeVisible();
  const bounds = await popup.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(812);
  await page.keyboard.press('End');
  await page.keyboard.press('Escape');
  await expect(popup).toHaveCount(0);
});
