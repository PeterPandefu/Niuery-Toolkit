import { expect, test } from '@playwright/test';

// 界面使用模拟 IPC；真实 Windows 占用与结束操作由 Rust 集成测试覆盖。
test.beforeEach(async ({ page }) => {
  await page.route('**/__unlocker-test', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<html lang="zh-CN"><body><div id="root" style="height:100vh"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type; window.__vite_plugin_react_preamble_installed__ = true;</script><script type="module" src="/e2e/resource-unlocker.fixture.tsx"></script></body></html>',
  }));
  await page.addInitScript(() => {
    let ended = false;
    const calls: { command: string; args: unknown }[] = [];
    Object.assign(window, {
      resourceTestCalls: calls,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: unknown) => {
          calls.push({ command, args });
          if (command === 'terminate_processes') {
            ended = true;
            return [{ pid: 9527, status: 'terminated', message: null }];
          }
          if (command.startsWith('find_')) return ended ? [] : [{
            target: { pid: 9527, creationTime: '134052868280123457' },
            name: '验证进程.exe', executablePath: 'C:\\测试\\验证进程.exe', endpoints: [],
          }];
          if (command === 'pick_existing_folder') return 'C:\\测试目录';
          if (command === 'pick_existing_file') return 'C:\\测试目录\\文件.txt';
          throw new Error(`未知命令：${command}`);
        },
      },
    });
  });
  await page.goto('/__unlocker-test');
  await expect(page.getByRole('heading', { name: '占用解除' })).toBeVisible();
});

for (const mode of [
  { name: '端口', label: '端口号', value: '5173', action: '结束占用进程', command: 'find_port_owners' },
  { name: '文件', label: '文件路径', value: 'C:\\测试目录\\文件.txt', action: '解除文件占用', command: 'find_file_lock_owners' },
  { name: '文件夹', label: '文件夹路径', value: 'C:\\测试目录', action: '解除文件夹占用', command: 'find_folder_lock_owners' },
]) {
  test(`${mode.name}：选择目标、查询、取消与确认、复查`, async ({ page }) => {
    await page.getByRole('button', { name: mode.name, exact: true }).click();
    if (mode.name === '端口') await page.getByLabel(mode.label).fill(mode.value);
    else await page.getByRole('button', { name: `选择${mode.name}`, exact: true }).click();
    await expect(page.getByLabel(mode.label)).toHaveValue(mode.value);
    await page.getByRole('button', { name: '查找占用进程' }).click();
    await expect(page.getByText('验证进程.exe', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: mode.action }).click();
    await expect(page.getByRole('dialog')).toContainText(mode.value);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: mode.action })).toBeFocused();
    await page.getByRole('button', { name: mode.action }).click();
    await page.getByRole('button', { name: '确认结束', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(`${mode.name}已解除占用`);
    await expect(page.getByRole('region', { name: '结束结果' })).toContainText('已结束');
    const calls = await page.evaluate(() => (window as unknown as { resourceTestCalls: { command: string; args: unknown }[] }).resourceTestCalls);
    expect(calls.filter((call) => call.command === mode.command)).toHaveLength(2);
    expect(calls.find((call) => call.command === 'terminate_processes')?.args).toEqual({
      targets: [{ pid: 9527, creationTime: '134052868280123457' }],
    });
  });
}

test('窄屏与深色主题下三种模式均可访问', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  for (const mode of ['端口', '文件', '文件夹']) {
    await page.getByRole('button', { name: mode, exact: true }).click();
    await expect(page.getByRole('button', { name: '查找占用进程' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.screenshot({ path: 'test-results/占用解除-窄屏.png', fullPage: true });
});
