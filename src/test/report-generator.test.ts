import { describe, expect, it } from 'vitest';
import { tableFromJson } from '@/tools/formatter/report-generator';

describe('数据报告表格生成', () => {
  it('应根据对象数组生成表头和数据行', () => {
    const result = tableFromJson('[{"名称":"示例","数量":2}]');
    expect(result.error).toBeUndefined();
    expect(result.html).toContain('<th>名称</th>');
    expect(result.html).toContain('<td>2</td>');
  });

  it('应拒绝非对象数组', () => {
    expect(tableFromJson('{"名称":"示例"}').error).toBeTruthy();
  });
});
