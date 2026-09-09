import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { LocalizedToolErrorBoundary } from '@/components/shared/ToolErrorBoundary';

function BrokenTool(): never {
  throw new Error('测试工具异常');
}

describe('工具错误边界', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('隔离工具异常并提供重新加载与复制入口', () => {
    render(
      <LocalizedToolErrorBoundary toolId="broken-tool" toolName="测试工具">
        <BrokenTool />
      </LocalizedToolErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reload tool|重新加载工具/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy error details|复制错误详情/ })).toBeInTheDocument();
  });
});
