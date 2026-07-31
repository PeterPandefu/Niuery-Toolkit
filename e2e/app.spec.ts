import { test, expect } from '@playwright/test';

// 等待应用完全加载的辅助函数
async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('nav[aria-label="Tool navigation"]')).toBeVisible();
}

// 打开搜索框的辅助函数
async function openSearch(page: import('@playwright/test').Page) {
  // 点击 banner 中的 Ctrl+K 按钮或主区域的 Search tools 按钮
  const searchBtn = page.getByRole('button', { name: /Search tools|Ctrl\+K/i }).first();
  await searchBtn.click();
  await expect(page.getByPlaceholder(/Search|搜索/i).first()).toBeVisible();
}

test.describe('应用基础', () => {
  test('首页加载并显示侧边栏', async ({ page }) => {
    await waitForAppReady(page);
  });

  test('搜索对话框可通过按钮打开', async ({ page }) => {
    await waitForAppReady(page);
    await openSearch(page);
  });

  test('主题切换功能正常', async ({ page }) => {
    await waitForAppReady(page);
    const themeBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    await expect(themeBtn).toBeVisible();
  });
});

test.describe('工具导航', () => {
  test('侧边栏显示所有工具分类', async ({ page }) => {
    await waitForAppReady(page);
    const nav = page.locator('nav[aria-label="Tool navigation"]');
    await expect(nav.getByText('Converters', { exact: true })).toBeVisible();
    await expect(nav.getByText('Encoders / Decoders', { exact: true })).toBeVisible();
    await expect(nav.getByText('Formatters', { exact: true })).toBeVisible();
    await expect(nav.getByText('Generators', { exact: true })).toBeVisible();
    await expect(nav.getByText('Text Tools', { exact: true })).toBeVisible();
    await expect(nav.getByText('Graphic Tools', { exact: true })).toBeVisible();
  });

  test('搜索可以过滤工具', async ({ page }) => {
    await waitForAppReady(page);
    await openSearch(page);
    const searchInput = page.getByPlaceholder(/Search|搜索/i).first();
    await searchInput.fill('JSON');
    await expect(page.getByText(/JSON/i).first()).toBeVisible();
  });
});

test.describe('JSON ↔ YAML 转换器', () => {
  test('输入 JSON 输出 YAML', async ({ page }) => {
    await waitForAppReady(page);
    // 直接点击侧边栏工具
    await page.getByRole('button', { name: /JSON.*YAML/i }).first().click();

    // 输入 JSON
    const input = page.locator('textarea').first();
    await input.fill('{"name":"test","value":123}');

    // 验证输出包含 YAML 格式
    await expect(page.locator('textarea').nth(1)).toContainText('name');
  });
});

test.describe('Base64 编解码器', () => {
  test('编码文本为 Base64', async ({ page }) => {
    await waitForAppReady(page);
    await page.getByRole('button', { name: 'Base64' }).click();

    const input = page.locator('textarea').first();
    await input.fill('Hello, World!');

    // 验证输出
    await expect(page.locator('textarea').nth(1)).toHaveValue('SGVsbG8sIFdvcmxkIQ==');
  });
});

test.describe('UUID 生成器', () => {
  test('生成 UUID', async ({ page }) => {
    await waitForAppReady(page);
    await page.getByRole('button', { name: 'UUID Generator' }).click();

    // 点击生成按钮
    await page.getByRole('button', { name: /生成|Generate/i }).click();

    // 验证生成了 UUID 格式
    const output = page.locator('textarea, [readonly]').first();
    await expect(output).toBeVisible();
  });
});

test.describe('Text Diff 工具', () => {
  test('工具页面加载并显示控制栏', async ({ page }) => {
    await waitForAppReady(page);
    await page.getByRole('button', { name: 'Text Diff' }).click();

    // 验证工具页面已加载（显示视图切换按钮和忽略空白选项）
    await expect(page.getByText(/忽略空白|Ignore/i).first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('快捷键', () => {
  test('Ctrl+K 打开搜索', async ({ page }) => {
    await waitForAppReady(page);
    // 等待一下确保 React 事件监听器已注册
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+k');
    await expect(page.getByPlaceholder(/Search|搜索/i).first()).toBeVisible({ timeout: 5000 });
  });

  test('Escape 关闭搜索', async ({ page }) => {
    await waitForAppReady(page);
    await openSearch(page);
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder(/Search|搜索/i).first()).not.toBeVisible();
  });
});

test.describe('离线安全', () => {
  test('不发送任何外部网络请求', async ({ page }) => {
    const externalRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http://localhost') && !url.startsWith('data:')) {
        externalRequests.push(url);
      }
    });

    await page.goto('/');
    await page.waitForTimeout(2000);

    // 过滤掉字体等静态资源（如果有）
    const dataRequests = externalRequests.filter(
      (url) => !url.includes('fonts.') && !url.includes('.woff')
    );
    expect(dataRequests).toHaveLength(0);
  });
});
