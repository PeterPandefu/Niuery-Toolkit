import { createRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { AiDialog } from '@/tools/ai-assistant/ui';
import '@/i18n';

afterEach(cleanup);

const options = [{ value: 'a', label: '选项甲' }, { value: 'b', label: '选项乙' }];

describe('通用下拉选择组件', () => {
  it('通过原生 change 事件保留表单值、引用及现有业务回调', () => {
    const nativeRef = createRef<HTMLSelectElement>();
    const changed = vi.fn();
    function Form() {
      const [value, setValue] = useState('a');
      return <form aria-label="设置表单"><Label htmlFor="format">输出格式</Label><Select ref={nativeRef} id="format" name="format" value={value} options={options} onChange={event => { changed(event.target.value, event.currentTarget.name); setValue(event.target.value); }} /></form>;
    }
    render(<Form />);
    const trigger = screen.getByRole('combobox', { name: '输出格式' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: '选项乙' }));
    expect(changed).toHaveBeenCalledExactlyOnceWith('b', 'format');
    expect(trigger).toHaveValue('b');
    expect(trigger).toHaveTextContent('选项乙');
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).get('format')).toBe('b');
    expect(nativeRef.current).toHaveValue('b');
    expect(screen.getAllByRole('combobox')).toHaveLength(1);
    expect(trigger).toHaveFocus();
  });

  it('支持原生选项子节点、分组和禁用选项，键盘跳过不可用项', () => {
    render(<Select aria-label="模型" defaultValue="a"><optgroup label="本地服务"><option value="a">模型甲</option><option disabled value="b">模型乙</option></optgroup><optgroup label="远程服务"><option value="c">模型丙</option></optgroup></Select>);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    expect(screen.getByText('本地服务')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '模型乙' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('option', { name: '模型乙' }));
    expect(trigger).toHaveValue('a');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(trigger).toHaveAttribute('aria-activedescendant', screen.getByRole('option', { name: '模型丙' }).id);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(trigger).toHaveValue('c');
  });

  it('未受控模式默认选择第一项，并随表单重置恢复默认值', async () => {
    render(<form aria-label="设置表单"><Select aria-label="输出格式" options={options} /></form>);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveValue('a');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: '选项乙' }));
    expect(trigger).toHaveValue('b');
    await act(async () => (screen.getByRole('form') as HTMLFormElement).reset());
    expect(trigger).toHaveValue('a');
  });

  it('读取相邻标签作为名称，并支持外部更新及空列表', () => {
    const { rerender } = render(<><Label>输出格式</Label><Select value="a" options={options} /></>);
    expect(screen.getByRole('combobox', { name: '输出格式' })).toHaveValue('a');
    rerender(<><Label>输出格式</Label><Select value="b" options={options} /></>);
    expect(screen.getByRole('combobox', { name: '输出格式' })).toHaveValue('b');
    rerender(<><Label>输出格式</Label><Select value="" options={[]} /></>);
    const trigger = screen.getByRole('combobox', { name: '输出格式' });
    expect(trigger).toHaveTextContent('请选择');
    fireEvent.click(trigger);
    expect(screen.getByRole('status')).toHaveTextContent('暂无可选项');
    expect(trigger).not.toHaveAttribute('aria-activedescendant');
  });

  it('在弹窗内打开时保持可访问性，第一次 Escape 只关闭下拉列表', () => {
    const onClose = vi.fn();
    render(<AiDialog title="模型设置" onClose={onClose}><label>输出格式<Select options={options} /></label></AiDialog>);
    const dialog = screen.getByRole('dialog');
    const trigger = within(dialog).getByRole('combobox');
    trigger.focus();
    fireEvent.click(trigger);
    expect(within(dialog).getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('禁用字段集中的选择器不会打开列表', () => {
    render(<fieldset disabled><Select aria-label="输出格式" options={options} /></fieldset>);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('必填校验聚焦可见触发器，选择有效值后清除错误状态', () => {
    render(<form aria-label="设置表单"><Select required aria-label="输出格式" defaultValue="" options={[{ value: '', label: '请选择格式' }, ...options]} /></form>);
    const trigger = screen.getByRole('combobox');
    act(() => { expect((screen.getByRole('form') as HTMLFormElement).checkValidity()).toBe(false); });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('option', { name: '选项乙' }));
    expect((screen.getByRole('form') as HTMLFormElement).checkValidity()).toBe(true);
    expect(trigger).not.toHaveAttribute('aria-invalid');
  });

  it('将焦点和键盘回调交给可见触发器，并允许业务阻止默认行为', () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    render(<Select aria-label="输出格式" options={options} onFocus={onFocus} onBlur={onBlur} onKeyDown={event => event.preventDefault()} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.focus(trigger);
    expect(onFocus).toHaveBeenCalledOnce();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.blur(trigger);
    expect(onBlur).toHaveBeenCalledOnce();
  });
});
