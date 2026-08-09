import { expect, test, type Page } from '@playwright/test';

type OcrCase = {
  name: string;
  language: 'chi_sim' | 'eng' | 'chi_sim+eng';
  text: string;
};

const cases: OcrCase[] = [
  {
    name: '中文',
    language: 'chi_sim',
    text: '智能图像文字识别测试\n清晰中文识别率达到百分之九十五以上',
  },
  {
    name: '英文',
    language: 'eng',
    text: 'High quality optical character recognition\nmust exceed ninety-five percent accuracy.',
  },
  {
    name: '中英文混合',
    language: 'chi_sim+eng',
    text: 'Niuery 工具箱 OCR v2.0\n中文 English 混合识别 95% 通过',
  },
];

function createTextImage(text: string) {
  const lines = text.split('\n');
  const textNodes = lines
    .map((line, index) => `<text x="48" y="${92 + index * 88}">${line}</text>`)
    .join('');

  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${lines.length * 100 + 72}" viewBox="0 0 1200 ${lines.length * 100 + 72}">
      <rect width="100%" height="100%" fill="#ffffff"/>
      <style>text { fill: #111827; font: 52px "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif; }</style>
      ${textNodes}
    </svg>
  `);
}

function normalize(text: string) {
  return text.replace(/\s/g, '').normalize('NFKC');
}

function characterAccuracy(expected: string, actual: string) {
  const source = normalize(expected);
  const target = normalize(actual);
  const previous = Array.from({ length: target.length + 1 }, (_, index) => index);

  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    let diagonal = previous[0];
    previous[0] = sourceIndex;
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const above = previous[targetIndex];
      previous[targetIndex] = Math.min(
        previous[targetIndex] + 1,
        previous[targetIndex - 1] + 1,
        diagonal + Number(source[sourceIndex - 1] !== target[targetIndex - 1])
      );
      diagonal = above;
    }
  }

  return 1 - previous[target.length] / source.length;
}

async function openOcr(page: Page) {
  await page.goto('/');
  await expect(page.locator('nav[aria-label="Category navigation"]')).toBeVisible();
  await page.keyboard.press('Control+k');
  const search = page.getByPlaceholder(/Search|搜索/i).first();
  await expect(search).toBeVisible();
  await search.fill('图片处理');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '图片 OCR' }).click();
}

for (const ocrCase of cases) {
  test(`图片 OCR 的${ocrCase.name}字符准确率不低于 95%`, async ({ page }) => {
    test.setTimeout(120_000);
    await openOcr(page);
    await page.locator('select').selectOption(ocrCase.language);
    await page.locator('input[type="file"]').setInputFiles({
      name: `${ocrCase.name}.svg`,
      mimeType: 'image/svg+xml',
      buffer: createTextImage(ocrCase.text),
    });
    await page.getByRole('button', { name: '开始识别' }).click();

    const result = page.getByLabel('识别结果');
    await expect(result).toBeVisible({ timeout: 100_000 });
    const recognized = await result.inputValue();
    const accuracy = characterAccuracy(ocrCase.text, recognized);

    expect(accuracy, `识别结果：${recognized}`).toBeGreaterThanOrEqual(0.95);
  });
}
