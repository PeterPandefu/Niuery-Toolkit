import { describe, expect, it } from 'vitest';
import { diagnoseHtml } from '@/lib/html-diagnostics';

describe('HTML 诊断', () => {
  it('应报告离线资源和缺少 viewport/title', () => {
    const result = diagnoseHtml('<img src="https://example.com/a.png"><script src="https://example.com/a.js"></script>');
    expect(result.remoteResources).toEqual(['https://example.com/a.png', 'https://example.com/a.js']);
    expect(result.imageCount).toBe(1);
    expect(result.scriptCount).toBe(1);
    expect(result.warnings.join('；')).toContain('远程资源');
  });

  it('完整的本地 HTML 不应产生诊断警告', () => {
    const result = diagnoseHtml('<meta name="viewport" content="width=device-width"><title>Demo</title><p>内容</p>');
    expect(result.warnings).toEqual([]);
  });
});
