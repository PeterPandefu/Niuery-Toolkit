import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const flowchart = '```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```';
const stateDiagram = `\`\`\`mermaid
stateDiagram-v2
  [*] --> Dash: 该项目首次结果
  Dash --> r: 拟：手工/危急值/LIS同项目工单新建的重测行且未出结果
  r --> R: 该重测行返回结果
  r --> Dash: 等待超时或失败
  Dash --> R: 拟：仪器自行再次上报（无过程态）
\`\`\``;
const erDiagram = `\`\`\`mermaid
erDiagram
  samples ||--|{ TestItem : contains
  TestItem {
    string itemId PK
    string assayName
    string status
    bool isRetest
    string retestOriginalId
    string retestSource "拟 Manual或Lis"
    string deviceId
    string channelNo
    bool handled
    string handleOpinion
    datetime createdTime
  }
\`\`\``;

async function openMarkdownEditor(page: Page, content: string) {
  await page.addInitScript((draft) => {
    localStorage.setItem('niuery-markdown-editor-draft', draft);
  }, content);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: /工具分类|Category navigation/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search|搜索/i).first().fill('Markdown Editor');
  await page.keyboard.press('Enter');
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 60_000 });
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

  test('支持带中文长标签的状态图和 ER 图', async ({ page }) => {
    await openMarkdownEditor(page, `${stateDiagram}\n\n${erDiagram}`);

    await expect(page.locator('.markdown-preview .mermaid-svg svg')).toHaveCount(2, { timeout: 15_000 });
    await expect(page.locator('.markdown-preview .mermaid-error')).toHaveCount(0);
  });

  test('减少动画时画布尺寸仍贴合流程图、状态图和 ER 图', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMarkdownEditor(page, `${flowchart}\n\n${stateDiagram}\n\n${erDiagram}`);

    const diagrams = page.locator('.markdown-preview .mermaid-svg svg');
    await expect(diagrams).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('.markdown-preview .mermaid-error')).toHaveCount(0);
    for (const diagram of await diagrams.all()) {
      await expect.poll(() => diagram.evaluate((svg: SVGSVGElement) => {
        const bounds = svg.getBBox();
        return Math.max(
          Math.abs(svg.viewBox.baseVal.width - bounds.width),
          Math.abs(svg.viewBox.baseVal.height - bounds.height),
        );
      })).toBeLessThanOrEqual(20);
    }
  });

  test('放大预览的 SVG 使用图表固有尺寸，支持状态图、ER 图和流程图', async ({ page }) => {
    await openMarkdownEditor(page, `${stateDiagram}\n\n${erDiagram}\n\n${flowchart}`);

    const diagrams = page.locator('.markdown-preview .mermaid-diagram[role="button"]');
    await expect(diagrams).toHaveCount(3, { timeout: 15_000 });

    for (let index = 0; index < 3; index++) {
      const viewBox = await diagrams.nth(index).locator('svg').evaluate((svg: SVGSVGElement) => ({
        width: svg.viewBox.baseVal.width,
        height: svg.viewBox.baseVal.height,
      }));
      if (index === 1) {
        await diagrams.nth(index).focus();
        await page.keyboard.press('Enter');
      } else {
        await diagrams.nth(index).click();
      }

      const image = page.getByRole('dialog', { name: '图片预览', exact: true }).locator('img');
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      const dimensions = await image.evaluate((img: HTMLImageElement) => ({
        width: img.naturalWidth,
        height: img.naturalHeight,
      }));
      expect(Math.abs(dimensions.width - viewBox.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(dimensions.height - viewBox.height)).toBeLessThanOrEqual(1);

      await page.getByRole('button', { name: '适应窗口', exact: true }).click();
      await page.getByRole('button', { name: '原始大小', exact: true }).click();
      await page.getByRole('button', { name: '全屏预览', exact: true }).click();
      await expect(image).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: '图片预览', exact: true })).toHaveCount(0);
    }
  });

  test('含 HTML 换行和实体的 Mermaid 标签可点击和键盘打开放大预览', async ({ page }) => {
    await openMarkdownEditor(page, '```mermaid\nflowchart TD\n  A["接收结果<br/>样本标识、设备、通道、结果值"] --> B["当前配置<br>AssayId &amp; 默认项目&nbsp;D"]\n```');

    const diagram = page.locator('.markdown-preview .mermaid-diagram[role="button"]');
    await expect(diagram.locator('svg foreignObject br').first()).toBeAttached({ timeout: 15_000 });

    for (const trigger of ['click', 'Space'] as const) {
      if (trigger === 'click') {
        await diagram.click();
      } else {
        await diagram.focus();
        await page.keyboard.press(trigger);
      }
      const image = page.getByRole('dialog', { name: '图片预览', exact: true }).locator('img');
      await expect(image).toBeVisible();
      const preview = await image.evaluate(async (img: HTMLImageElement) => {
        const svg = new DOMParser().parseFromString(await (await fetch(img.src)).text(), 'image/svg+xml');
        return {
          error: svg.querySelector('parsererror')?.textContent ?? null,
          labels: [...svg.querySelectorAll('foreignObject')].map((label) => label.textContent).join(' '),
        };
      });
      expect(preview.error).toBeNull();
      expect(preview.labels).toContain('样本标识、设备、通道、结果值');
      expect(preview.labels).toContain('AssayId & 默认项目\u00a0D');
      await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: '图片预览', exact: true })).toHaveCount(0);
    }
  });

  test('工具栏插入 Mermaid 模板', async ({ page }) => {
    await openMarkdownEditor(page, '替换这段内容');

    await page.getByRole('button', { name: /Mermaid 图表|Mermaid Diagram/ }).click();
    await page.getByRole('menuitem', { name: /流程图|Flowchart/ }).click();

    await expect(page.locator('.monaco-editor')).toContainText('flowchart TD');
    await expect(page.locator('.markdown-preview .mermaid-svg svg')).toBeVisible({ timeout: 15_000 });
  });
});
