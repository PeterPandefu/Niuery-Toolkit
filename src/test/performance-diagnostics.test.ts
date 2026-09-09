import { describe, expect, it, vi } from 'vitest';
import { clearPerformanceMark, markPerformance, measurePerformance } from '@/lib/performance-diagnostics';

describe('性能诊断标记', () => {
  it('记录并测量启动或工具挂载耗时', () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(100).mockReturnValueOnce(146.8);

    markPerformance('test-start');
    expect(measurePerformance('测试阶段', 'test-start', { toolId: 'test-tool' })).toBeCloseTo(46.8);

    clearPerformanceMark('test-start');
    expect(measurePerformance('测试阶段', 'test-start')).toBeNull();
    now.mockRestore();
  });
});
