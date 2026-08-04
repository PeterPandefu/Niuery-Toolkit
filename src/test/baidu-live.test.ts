import { describe, expect, it } from 'vitest';
import { translateWithBaidu } from '@/lib/translate-utils';

/**
 * 百度翻译在线集成测试：仅当环境变量 BAIDU_APP_ID / BAIDU_SECRET 存在时运行。
 * 运行示例（PowerShell）：
 *   $env:BAIDU_APP_ID='...'; $env:BAIDU_SECRET='...'; npx vitest run src/test/baidu-live.test.ts
 */
const appId = process.env.BAIDU_APP_ID;
const secret = process.env.BAIDU_SECRET;
const describeLive = appId && secret ? describe : describe.skip;

describeLive('百度翻译在线验证（env 门控）', () => {
  it(
    '英译中：hello → 你好',
    async () => {
      const result = await translateWithBaidu('hello', 'en', 'zh', { appId: appId!, secret: secret! }, (url, init) =>
        fetch(url, init)
      );
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.to).toBe('zh');
    },
    15000
  );

  it(
    '长文本（>20 字符）完整签名路径',
    async () => {
      const longText = 'The quick brown fox jumps over the lazy dog, and keeps running across the field.';
      const result = await translateWithBaidu(longText, 'auto', 'zh', { appId: appId!, secret: secret! }, (url, init) =>
        fetch(url, init)
      );
      expect(result.text.length).toBeGreaterThan(0);
    },
    15000
  );
});
