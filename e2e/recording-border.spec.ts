import { expect, test } from '@playwright/test';

for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
  test(`录制边框在 ${scale * 100}% 缩放下不进入采集像素`, async ({ browser }) => {
    // 原生窗口在采集矩形四周各外扩 3 个物理像素。
    const context = await browser.newContext({
      deviceScaleFactor: scale,
      viewport: { width: 400, height: 300 },
    });
    try {
      const page = await context.newPage();
      await page.goto('/#/recording-capture-border');
      await expect(page.getByTestId('recording-capture-border')).toBeVisible();
      const screenshot = await page.screenshot({ omitBackground: true, animations: 'disabled' });
      const result = await page.evaluate(async (bytes) => {
        const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let capturedBorderPixels = 0;
        let visibleBorderPixels = 0;
        for (let y = 0; y < canvas.height; y++) {
          for (let x = 0; x < canvas.width; x++) {
            if (data[(y * canvas.width + x) * 4 + 3] === 0) continue;
            visibleBorderPixels++;
            if (x >= 3 && y >= 3 && x < canvas.width - 3 && y < canvas.height - 3) {
              capturedBorderPixels++;
            }
          }
        }
        return { capturedBorderPixels, visibleBorderPixels };
      }, Array.from(screenshot));
      expect(result.visibleBorderPixels, '用户仍应看得到录制范围边框').toBeGreaterThan(0);
      expect(result.capturedBorderPixels, '录制画面内不应包含边框像素').toBe(0);
    } finally {
      await context.close();
    }
  });
}
