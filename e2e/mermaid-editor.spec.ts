import { expect, test } from '@playwright/test';

test('Mermaid 实时编辑器可预览含 HTML 换行标签的图表', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: /工具分类|Category navigation/ })).toBeVisible();

  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder(/Search|搜索/i).first();
  await search.fill('Mermaid Live Editor');
  await page.keyboard.press('Enter');

  await expect(page.getByRole('heading', { name: /Mermaid 实时编辑器|Mermaid Live Editor/ })).toBeVisible();
  const source = `flowchart TD\n  A["接收结果<br/>样本标识、设备、通道、结果值"] --> B["当前配置<br>AssayId &amp; 默认项目&nbsp;D"]`;
  const editor = page.locator('.monaco-editor').first();
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(source);

  const image = page.getByRole('img', { name: /Mermaid 实时编辑器 预览|Mermaid Live Editor preview/ });
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
});
