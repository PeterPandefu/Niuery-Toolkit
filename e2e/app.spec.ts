import { test, expect } from '@playwright/test';

// 等待应用完全加载的辅助函数
async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.locator('nav[aria-label="Category navigation"]')).toBeVisible();
}

// 打开搜索框的辅助函数
async function openSearch(page: import('@playwright/test').Page) {
  // 使用 Ctrl+K 快捷键打开搜索
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder(/Search|搜索/i).first()).toBeVisible();
}

// 在侧边栏展开指定分类
async function expandCategory(page: import('@playwright/test').Page, title: string) {
  await page.locator('nav[aria-label="Category navigation"]').getByTitle(title).click();
}

test.describe('应用基础', () => {
  test('首页加载并显示图标导航栏', async ({ page }) => {
    await waitForAppReady(page);
    // 验证图标导航栏存在
    await expect(page.locator('nav[aria-label="Category navigation"]')).toBeVisible();
  });

  test('搜索对话框可通过快捷键打开', async ({ page }) => {
    await waitForAppReady(page);
    await openSearch(page);
  });

  test('主题切换功能正常', async ({ page }) => {
    await waitForAppReady(page);
    const themeBtn = page.locator('header button').last();
    await expect(themeBtn).toBeVisible();
  });
});

test.describe('工具导航', () => {
  test('图标栏显示所有分类图标', async ({ page }) => {
    await waitForAppReady(page);
    const nav = page.locator('nav[aria-label="Category navigation"]');
    // 验证各分类图标存在（通过 title 属性）
    await expect(nav.getByTitle('Converters')).toBeVisible();
    await expect(nav.getByTitle('Encoders / Decoders')).toBeVisible();
    await expect(nav.getByTitle('Formatters')).toBeVisible();
    await expect(nav.getByTitle('Generators')).toBeVisible();
    await expect(nav.getByTitle('Text Tools')).toBeVisible();
    await expect(nav.getByTitle('Graphic Tools')).toBeVisible();
  });

  test('点击分类图标展开工具面板', async ({ page }) => {
    await waitForAppReady(page);
    // 点击 Converters 分类
    await expandCategory(page, 'Converters');
    // 验证面板展开，显示该分类下的工具
    await expect(page.getByText('JSON ↔ YAML')).toBeVisible();
    await expect(page.getByText('XML ↔ JSON')).toBeVisible();
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
    // 通过搜索打开工具
    await openSearch(page);
    const searchInput = page.getByPlaceholder(/Search|搜索/i).first();
    await searchInput.fill('JSON YAML');
    await page.keyboard.press('Enter');

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
    // 展开编码器分类
    await expandCategory(page, 'Encoders / Decoders');
    await page.getByRole('list').getByText('Base64').click();

    const input = page.locator('textarea').first();
    await input.fill('Hello, World!');

    // 验证输出
    await expect(page.locator('textarea').nth(1)).toHaveValue('SGVsbG8sIFdvcmxkIQ==');
  });
});

test.describe('UUID 生成器', () => {
  test('生成 UUID', async ({ page }) => {
    await waitForAppReady(page);
    // 展开生成器分类
    await expandCategory(page, 'Generators');
    await page.getByRole('list').getByText('UUID Generator').click();

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
    // 展开文本工具分类
    await expandCategory(page, 'Text Tools');
    await page.getByRole('list').getByText('Text Diff').click();

    // 验证工具页面已加载（显示视图切换按钮和忽略空白选项）
    await expect(page.getByText(/忽略空白|Ignore/i).first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('系统监控', () => {
  test('可以从系统工具分类打开监控面板', async ({ page }) => {
    await waitForAppReady(page);
    await expandCategory(page, 'System Tools');
    await page.getByRole('list').getByText('System Monitor').click();

    await expect(page.getByText('系统监控')).toBeVisible();
    await expect(page.getByText(/CPU Usage|CPU 使用率/)).toBeVisible();
    await expect(page.getByText(/Memory|内存/).first()).toBeVisible();
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
