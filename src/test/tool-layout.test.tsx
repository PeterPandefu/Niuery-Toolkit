import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import { ToolLayout } from '@/components/shared/ToolLayout';

describe('共享工具布局动作', () => {
  it('为通用动作提供本地化标签，并在没有输出时禁用复制', () => {
    render(
      <ToolLayout
        input={<textarea aria-label="input" />}
        output={<div />}
        outputValue=""
        onClear={() => undefined}
        onSwap={() => undefined}
      />
    );

    expect(screen.getByRole('button', { name: /Clear input|清空输入/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Swap input\/output|交换输入输出/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copy output|复制输出/ })).toBeDisabled();
  });
});
