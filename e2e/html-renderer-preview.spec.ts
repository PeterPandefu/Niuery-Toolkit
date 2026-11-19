import { expect, test } from '@playwright/test';

const WIDE_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>固定宽大屏</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#0b1220;color:#e6f0ff}
.stage{width:1920px;height:1080px;position:relative}
.right{position:absolute;left:1500px;top:40px;width:380px;height:400px;border:2px solid #f472b6}
.tag{position:absolute;left:1600px;top:900px;font-size:40px;color:#fde047}</style></head>
<body><div class="stage"><div class="right">RIGHT PANEL</div><div class="tag">BOTTOM-RIGHT</div></div></body></html>`;

const FLUID_HTML = '<!doctype html><html><head><meta charset="utf-8"><title>流式文档</title></head><body><p>普通流式内容</p></body></html>';

async function openRenderer(page: import('@playwright/test').Page, html: string) {
  await page.addInitScript((content) => {
    localStorage.setItem('niuery-html-renderer-tabs', JSON.stringify({ version: 1, tabs: [{ id: 't1', name: 'case.html', content }], activeId: 't1' }));
  }, html);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('navigation', { name: /工具分类|Category navigation/ })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/Search|搜索/i).first().fill('HTML 离线渲染器');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'HTML 离线渲染器' })).toBeVisible({ timeout: 30_000 });
}

function previewFrame(page: import('@playwright/test').Page) {
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
  if (!frame) throw new Error('预览 iframe 未创建');
  return frame;
}

test('HTML 离线渲染器固定宽内容右侧完整可见', async ({ page }) => {
  await openRenderer(page, WIDE_HTML);
  await expect.poll(() => previewFrame(page).evaluate(() => window.innerWidth)).toBe(1920);

  const geometry = await previewFrame(page).evaluate(() => {
    const right = document.querySelector('.right')!.getBoundingClientRect();
    const tag = document.querySelector('.tag')!.getBoundingClientRect();
    return { viewport: window.innerWidth, rightEdge: right.right, tagEdge: tag.right };
  });
  expect(geometry.rightEdge).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.tagEdge).toBeLessThanOrEqual(geometry.viewport);
  await expect(page.getByText(/预览缩放/)).not.toHaveText('预览缩放 100%');
});

test('HTML 离线渲染器原始尺寸模式可横向滚动到右侧', async ({ page }) => {
  await openRenderer(page, WIDE_HTML);
  await expect.poll(() => previewFrame(page).evaluate(() => window.innerWidth)).toBe(1920);
  await page.getByRole('button', { name: '预览原始尺寸' }).click();
  const scroller = page.locator('iframe[title="HTML 本地预览"]').locator('xpath=../..');
  await expect.poll(() => scroller.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
  await expect(page.getByText('预览缩放 100%')).toBeVisible();
});

test('HTML 离线渲染器流式文档保持原始尺寸', async ({ page }) => {
  await openRenderer(page, FLUID_HTML);
  await expect(page.getByText('预览缩放 100%')).toBeVisible();
  await expect.poll(() => previewFrame(page).evaluate(() => document.documentElement.scrollWidth)).toBeLessThan(1000);
});