import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { SearchDialog } from '@/components/layout/SearchDialog';
import { useAppStore } from '@/store/app-store';

describe('工具搜索命令面板', () => {
  beforeEach(() => {
    useAppStore.setState({
      searchOpen: false,
      pinnedTools: ['json-formatter'],
      recentToolUsage: { timestamp: { count: 2, lastUsedOrder: 2 } },
    });
  });

  it('提供对话框、列表框语义，并在关闭后恢复触发按钮焦点', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    render(<SearchDialog onSelectTool={() => undefined} />);
    act(() => useAppStore.getState().setSearchOpen(true));

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-controls', 'tool-search-results');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(useAppStore.getState().searchOpen).toBe(false);
    expect(document.activeElement).toBe(trigger);

    trigger.remove();
  });

  it('无结果时给出可操作的搜索建议', () => {
    render(<SearchDialog onSelectTool={() => undefined} />);
    act(() => useAppStore.getState().setSearchOpen(true));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '不存在的工具' } });

    expect(screen.getByText(/Try a tool name|尝试搜索工具名称/)).toBeInTheDocument();
  });

  it('空查询时按快捷栏、最近使用和全部工具分组', () => {
    render(<SearchDialog onSelectTool={() => undefined} />);
    act(() => useAppStore.getState().setSearchOpen(true));

    expect(screen.getByRole('group', { name: /Quick Bar|快捷栏/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Recently used|最近使用/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /JSON Formatter|JSON 格式化/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Timestamp|时间戳转换/ })).toBeInTheDocument();
  });
});
