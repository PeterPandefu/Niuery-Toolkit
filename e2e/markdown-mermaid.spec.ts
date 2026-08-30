import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const flowchart = '```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```';

async function openMarkdownEditor(page: Page, content: string) {
  await page.addInitScript((draft) => {
    localStorage.setItem('niuery-markdown-editor-draft', draft);
  }, content);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('nav[aria-label="工具分类"]')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search|搜索/i).first().fill('Markdown Editor');
  await page.keyboard.press('Enter');
  await expect(page.locator('.monaco-editor')).toBeVisible();
}

test.describe('Markdown Mermaid', () => {
  test('本地渲染 Mermaid SVG，且不请求外部资源', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http://localhost:4173') && !url.startsWith('data:')) externalRequests.push(url);
    });

    await openMarkdownEditor(page, flowchart);

    await expect(page.locator('.markdown-preview .mermaid-svg svg')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/显示 Mermaid 源码|Show Mermaid source/)).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page.getByTitle('Export .html').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    expect(await readFile(downloadPath!, 'utf8')).toContain('<svg');
    await expect(page.getByText(/Exported HTML file.*browser download folder/i)).toBeVisible();

    const markdownDownloadPromise = page.waitForEvent('download');
    await page.getByTitle('Export .md').click();
    const markdownDownload = await markdownDownloadPromise;
    expect(await markdownDownload.path()).not.toBeNull();
    await expect(page.getByText(/Exported Markdown file.*browser download folder/i)).toBeVisible();

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:4173' });
    await page.getByTitle('Copy HTML').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('<svg');
    expect(externalRequests).toEqual([]);
  });

  test('无效 Mermaid 显示错误卡片并保留源码', async ({ page }) => {
    await openMarkdownEditor(page, '```mermaid\nflowchart TD\n  A -->\n```');

    await expect(page.locator('.markdown-preview .mermaid-error')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.markdown-preview .mermaid-source')).toContainText('A -->');
  });

  test('深色主题下仍可渲染图表', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('niuery-toolkit-store', JSON.stringify({
        state: { theme: 'dark', skin: 'ocean', recentTools: [], pinnedTools: [] },
        version: 1,
      }));
    });
    await openMarkdownEditor(page, flowchart);

    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('.markdown-preview .mermaid-svg svg')).toBeVisible({ timeout: 15_000 });
  });

  test('工具栏插入 Mermaid 模板', async ({ page }) => {
    await openMarkdownEditor(page, '替换这段内容');

    await page.getByRole('button', { name: /Mermaid 图表|Mermaid Diagram/ }).click();
    await page.getByRole('menuitem', { name: /流程图|Flowchart/ }).click();

    await expect(page.locator('.monaco-editor')).toContainText('flowchart TD');
    await expect(page.locator('.markdown-preview .mermaid-svg svg')).toBeVisible({ timeout: 15_000 });
  });
});
