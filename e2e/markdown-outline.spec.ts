import { expect, test, type Page } from '@playwright/test';

async function openOutline(page: Page, content: string) {
  await page.addInitScript((draft) => {
    localStorage.setItem('niuery-markdown-editor-draft', draft);
  }, content);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: /工具分类|Category navigation/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search|搜索/i).first().fill('Markdown Editor');
  await page.keyboard.press('Enter');
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 60_000 });
  await page.getByTitle(/^(文档大纲|Outline)$/i).click();
}

test('CRLF 文档恢复、导入和编辑后均生成大纲，并可跳转到标题', async ({ page }) => {
  const content = [
    '# 样本手工重测与复查结果 设计方案',
    '',
    '## 1. 背景',
    '正文',
    '```text',
    '# 代码块中的伪标题',
    '```',
    '## 2. 技术方案',
    '### 2.1 架构',
    '',
  ].join('\r\n');

  await openOutline(page, content);

  const title = page.getByRole('button', { name: '样本手工重测与复查结果 设计方案', exact: true });
  await expect(title).toBeVisible();
  await expect(page.getByRole('button', { name: '代码块中的伪标题', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '2.1 架构', exact: true }).click();
  await expect(page.getByText(/行 9, 列 1|Ln 9, Col 1/)).toBeVisible();

  const chooser = page.waitForEvent('filechooser');
  await page.getByTitle(/^(导入文件|Import File)$/i).click();
  await (await chooser).setFiles({
    name: 'outline-crlf.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(content.replace('1. 背景', '1. 导入背景')),
  });
  await expect(page.getByRole('button', { name: '1. 导入背景', exact: true })).toBeVisible();
  await expect(title).toBeVisible();
  await page.getByRole('button', { name: '2. 技术方案', exact: true }).click();
  await expect(page.getByText(/行 8, 列 1|Ln 8, Col 1/)).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.type(' updated');
  await expect(page.getByRole('button', { name: '2. 技术方案 updated', exact: true })).toBeVisible();
});

test('点击重复标题可在分栏、仅预览、仅编辑模式下定位对应位置', async ({ page }) => {
  const paragraphs = Array.from({ length: 35 }, (_, i) => `段落 ${i + 1}：${'测试内容。'.repeat(15)}\n`).join('\n');
  const content = `# 文档\n\n## 重复标题\n\n${paragraphs}\n## 重复标题\n\n${paragraphs}`;
  const targetLine = content.slice(0, content.lastIndexOf('## 重复标题')).split('\n').length;
  await openOutline(page, content);

  const buttons = page.getByRole('button', { name: '重复标题', exact: true });
  const target = page.locator('.markdown-preview h2').nth(1);
  const expectPreviewAtTarget = async () => {
    await expect.poll(() => target.evaluate((heading) => {
      const preview = heading.closest('.markdown-preview')!;
      return Math.abs(heading.getBoundingClientRect().top - preview.getBoundingClientRect().top - 16);
    })).toBeLessThan(3);
  };

  await buttons.nth(1).click();
  await expect(page.getByText(new RegExp(`行 ${targetLine}, 列 1|Ln ${targetLine}, Col 1`))).toBeVisible();
  await expectPreviewAtTarget();

  await page.getByTitle(/^(仅预览|Preview Only)$/).click();
  await buttons.nth(0).click();
  await buttons.nth(1).click();
  await expectPreviewAtTarget();

  // 手动滚动后重复点击同一大纲条目仍应跳转。
  await page.locator('.markdown-preview').evaluate((preview) => { preview.scrollTop = 0; });
  await buttons.nth(1).click();
  await expectPreviewAtTarget();

  await page.getByTitle(/^(仅编辑器|Editor Only)$/).click();
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await buttons.nth(0).click();
  await buttons.nth(1).click();
  await expect(page.getByText(new RegExp(`行 ${targetLine}, 列 1|Ln ${targetLine}, Col 1`))).toBeVisible();
});
