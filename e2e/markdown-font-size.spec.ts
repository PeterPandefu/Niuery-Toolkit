import { expect, test, type Locator } from '@playwright/test';

async function computedFontSize(locator: Locator) {
  return locator.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
}

test('公共字号控件同步调整源码与预览，并在三个视图间保留字号', async ({ page }) => {
  const content = [
    '# 字号测试',
    '',
    '正文与 `行内代码`',
    '',
    '- 列表条目',
    '',
    '> 引用文字',
    '',
    '| 表头 |',
    '| --- |',
    '| 表格内容 |',
    '',
    '```js',
    'const value = 1;',
    'console.log(value);',
    '```',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[开始] --> B[结束]',
    '```',
  ].join('\n');
  await page.addInitScript((draft) => {
    localStorage.setItem('niuery-toolkit-lang', 'zh');
    localStorage.setItem('niuery-markdown-editor-draft', draft);
  }, content);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: /工具分类|Category navigation/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('markdown-editor');
  await page.locator('#tool-search-option-markdown-editor').click();
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 60_000 });

  const group = page.getByRole('group', { name: '字号', exact: true });
  const decrease = group.getByRole('button', { name: '缩小字号', exact: true });
  const increase = group.getByRole('button', { name: '放大字号', exact: true });
  const reset = group.getByRole('button', { name: '恢复默认字号（14px）', exact: true });
  const preview = page.locator('.markdown-preview');
  const source = page.locator('.monaco-editor .view-lines');
  const svg = preview.locator('.mermaid-svg svg');
  await expect(svg).toBeVisible({ timeout: 30_000 });
  const originalSvg = await svg.elementHandle();
  const textElements = ['h1', 'p', 'li', 'blockquote', 'td', 'pre.hljs code', 'p > code']
    .map((selector) => preview.locator(selector).first());
  const defaultSizes = await Promise.all(textElements.map(computedFontSize));
  await expect(reset).toHaveText('14px');
  await expect.poll(() => computedFontSize(source)).toBe(14);

  await increase.click();
  await expect(reset).toHaveText('16px');
  await expect.poll(() => computedFontSize(source)).toBe(16);
  await expect.poll(() => computedFontSize(preview)).toBe(16);
  for (let index = 0; index < textElements.length; index++) {
    expect(await computedFontSize(textElements[index])).toBeCloseTo(defaultSizes[index] * 16 / 14, 1);
  }
  expect(await svg.evaluate((element, original) => element === original, originalSvg)).toBe(true);

  await page.getByTitle('仅预览', { exact: true }).click();
  await expect(source).toHaveCount(0);
  await expect(reset).toHaveText('16px');
  await increase.click();
  await expect.poll(() => computedFontSize(preview)).toBe(18);
  await preview.locator('.mermaid-diagram[role="button"]').click();
  await expect(page.getByRole('dialog', { name: '图片预览', exact: true }).locator('img')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTitle('仅编辑器', { exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect.poll(() => computedFontSize(source)).toBe(18);
  await decrease.click();
  await expect.poll(() => computedFontSize(source)).toBe(16);
  await page.getByTitle('分屏视图', { exact: true }).click();
  await expect.poll(() => computedFontSize(source)).toBe(16);
  await expect.poll(() => computedFontSize(preview)).toBe(16);

  await reset.click();
  await expect(reset).toHaveText('14px');
  await expect.poll(() => computedFontSize(source)).toBe(14);
  await expect.poll(() => computedFontSize(preview)).toBe(14);
  await decrease.click();
  await expect(reset).toHaveText('12px');
  await expect(decrease).toBeDisabled();
  for (let index = 0; index < 10; index++) await increase.click();
  await expect(reset).toHaveText('32px');
  await expect(increase).toBeDisabled();
  await expect.poll(() => computedFontSize(source)).toBe(32);
  await expect.poll(() => computedFontSize(preview.locator('pre.hljs code'))).toBe(32);
  expect(await preview.locator('pre.hljs').evaluate((element) => {
    const style = getComputedStyle(element);
    return parseFloat(style.lineHeight) / parseFloat(style.fontSize);
  })).toBeGreaterThan(1);
});
