import { expect, test, type Page } from '@playwright/test';

async function openTool(page: Page, keyword: string) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: /工具分类|Category navigation/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search|搜索/i).first().fill(keyword);
  await page.keyboard.press('Enter');
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 60_000 });
}

test('Markdown 编辑器多选文件后每个文件各建一个页签', async ({ page }) => {
  await openTool(page, 'Markdown');

  const chooser = page.waitForEvent('filechooser');
  await page.getByTitle(/^(导入文件|Import File)$/i).click();
  const selection = await chooser;
  expect(selection.isMultiple()).toBe(true);
  await selection.setFiles([
    { name: '批量甲.md', mimeType: 'text/markdown', buffer: Buffer.from('# 批量甲\n\n甲正文') },
    { name: '批量乙.md', mimeType: 'text/markdown', buffer: Buffer.from('# 批量乙\n\n乙正文') },
  ]);

  await expect(page.getByRole('tab', { name: '批量甲.md' })).toBeVisible();
  const lastTab = page.getByRole('tab', { name: '批量乙.md' });
  await expect(lastTab).toBeVisible();
  await expect(lastTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.monaco-editor')).toContainText('乙正文');
  await expect(page.getByText(/已导入 2 个文件|Imported 2 files/)).toBeVisible();
});

test('Mermaid 编辑器多选文件批量导入，Markdown 内多个代码块各建页签', async ({ page }) => {
  await openTool(page, 'Mermaid');
  await expect(page.getByRole('heading', { name: 'Mermaid 实时编辑器', exact: true })).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入源文件' }).click();
  const selection = await chooser;
  expect(selection.isMultiple()).toBe(true);
  await selection.setFiles([
    { name: '单独.mmd', mimeType: 'text/plain', buffer: Buffer.from('flowchart TD\nA --> 单独') },
    {
      name: '多块.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('```mermaid\nflowchart LR\nA --> 第一块\n```\n\n```mermaid\nsequenceDiagram\nAlice->>Bob: 第二块\n```'),
    },
  ]);

  await expect(page.getByRole('tab', { name: '单独.mmd' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '多块.md · 图表 1' })).toBeVisible();
  const lastTab = page.getByRole('tab', { name: '多块.md · 图表 2' });
  await expect(lastTab).toBeVisible();
  await expect(lastTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.monaco-editor')).toContainText('第二块');
  await expect(page.getByText('确认替换当前草稿')).toHaveCount(0);
});