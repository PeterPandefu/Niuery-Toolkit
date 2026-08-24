import { expect, test, type Page } from '@playwright/test';

async function openMindMap(page: Page) {
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByRole('main')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /Search tools|搜索工具/i }).first().click();
  const search = page.getByPlaceholder(/Search|搜索/i).first();
  await expect(search).toBeVisible();
  await search.fill('mind map');
  await page.keyboard.press('Enter');
  return page.getByLabel(/思维导图编辑画布|Mind map editing canvas/i);
}

test.describe('思维导图键盘快捷键', () => {
  test('显示节点编辑快捷键提示', async ({ page }) => {
    await openMindMap(page);

    await expect(page.getByText(/Tab.*(子节点|child).*Enter.*(同级|sibling).*Del.*(删除|delete)/i)).toBeVisible();
  });

  test('选中主题后 Tab 创建子主题，而不是将焦点移至工具栏', async ({ page }) => {
    const canvas = await openMindMap(page);
    const rootNode = canvas.locator('.smm-node').first();
    await expect(rootNode).toBeVisible();
    await rootNode.click();

    await page.keyboard.press('Tab');

    await expect(page.locator('[contenteditable="true"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /新建|New/i }).first()).not.toBeFocused();
  });

  test('根节点按 Del 后保持不变', async ({ page }) => {
    const canvas = await openMindMap(page);
    const rootNode = canvas.locator('.smm-node').first();
    await expect(rootNode).toBeVisible();
    await rootNode.click();

    await page.keyboard.press('Delete');
    await expect(canvas.getByText(/未命名思维导图|Untitled mind map/i).first()).toBeVisible();
  });

  test('Tab、Enter 与 Del 管理选中节点', async ({ page }) => {
    const canvas = await openMindMap(page);
    const rootNode = canvas.locator('.smm-node').first();
    await expect(rootNode).toBeVisible();

    await rootNode.click();
    await page.keyboard.press('Tab');
    const editor = page.locator('[contenteditable="true"]').last();
    await expect(editor).toBeVisible();
    await editor.fill('子主题');
    await page.keyboard.press('Tab');
    await expect(editor).toBeHidden();
    await expect(canvas.getByText('子主题', { exact: true })).toHaveCount(1);

    await page.keyboard.press('Enter');
    const siblingEditor = page.locator('[contenteditable="true"]').last();
    await expect(siblingEditor).toBeVisible();
    await siblingEditor.fill('同级主题');
    await page.keyboard.press('Enter');
    await expect(canvas.getByText('子主题', { exact: true })).toHaveCount(1);
    await expect(canvas.getByText('同级主题', { exact: true })).toHaveCount(1);

    await page.keyboard.press('Delete');
    await expect(canvas.getByText('子主题', { exact: true })).toHaveCount(1);
    await expect(canvas.getByText('同级主题', { exact: true })).toHaveCount(0);
  });

  test('搜索框中的 Enter 用于搜索导航，不创建节点', async ({ page }) => {
    const canvas = await openMindMap(page);
    const search = page.getByLabel(/搜索主题|Search topics/i);
    await search.fill('未命名思维导图');
    await page.keyboard.press('Enter');

    await expect(search).toBeFocused();
    await expect(canvas.getByText(/未命名思维导图|Untitled mind map/i)).toBeVisible();
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  });
});
