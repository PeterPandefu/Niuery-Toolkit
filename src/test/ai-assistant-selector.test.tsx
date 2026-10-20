import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiSelector } from '@/tools/ai-assistant/selector';

afterEach(cleanup);

const options = [
  { value: 'general', label: '通用助手', description: '日常问答、写作与分析' },
  { value: 'code', label: '编程助手', description: '代码分析与开发建议' },
  { value: 'translate', label: '翻译助手', description: '多语言翻译与润色' },
];

function Example() {
  const [value, setValue] = useState('general');
  return <><AiSelector label="助手" value={value} options={options} onChange={setValue} /><button>其他操作</button></>;
}

describe('AI 助手选择器', () => {
  it('支持方向键选择、回车确认，并让焦点保持在触发器', () => {
    render(<Example />);
    const trigger = screen.getByRole('combobox', { name: '助手' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const list = screen.getByRole('listbox', { name: '助手' });
    expect(within(list).getByRole('option', { name: '通用助手' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger).toHaveAttribute('aria-activedescendant', within(list).getByRole('option', { name: '编程助手' }).id);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(trigger).toHaveValue('code');
    expect(trigger).toHaveTextContent('编程助手');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('按 Escape、Tab 或点击外部关闭时保留原选择', () => {
    render(<Example />);
    const trigger = screen.getByRole('combobox');
    for (const key of ['Escape', 'Tab']) {
      fireEvent.click(trigger);
      fireEvent.keyDown(trigger, { key: 'End' });
      fireEvent.keyDown(trigger, { key });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveValue('general');
    }
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: '其他操作' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('按服务商分组模型，点击选项后回传完整模型标识', () => {
    const onChange = vi.fn();
    render(<AiSelector label="当前模型" variant="model" placement="top" value="local::m" options={[
      { value: 'local::m', label: '本地模型', group: 'Ollama' },
      { value: 'remote::m', label: '远程模型', group: '云端服务' },
    ]} onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveTextContent('Ollama');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: '远程模型' }));
    expect(onChange).toHaveBeenCalledWith('remote::m');
    expect(trigger).toHaveFocus();
  });

  it('支持输入模型名前缀定位，禁用后关闭列表且无法重新展开', () => {
    const props = { label: '当前模型', value: 'a', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }], onChange: vi.fn() };
    const { rerender } = render(<AiSelector {...props} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'b' });
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: 'Beta' }).id);
    rerender(<AiSelector {...props} disabled />);
    expect(trigger).toBeDisabled();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    rerender(<AiSelector {...props} />);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('无模型时提供设置提示，不产生选择回调', () => {
    const onChange = vi.fn();
    render(<AiSelector label="当前模型" value="" options={[]} placeholder="选择模型" emptyText="请先添加模型" onChange={onChange} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(screen.getByRole('status')).toHaveTextContent('请先添加模型');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
