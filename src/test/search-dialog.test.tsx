import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { SearchDialog } from '@/components/layout/SearchDialog';
import { useAppStore } from '@/store/app-store';
import i18n from '@/i18n';

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

  it('支持拼音全拼和分类筛选', () => {
    render(<SearchDialog onSelectTool={() => undefined} />);
    act(() => useAppStore.getState().setSearchOpen(true));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'geshihua' } });
    expect(screen.getByRole('option', { name: /JSON Formatter|JSON 格式化/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Language Translation|语言翻译/ }));
    expect(screen.queryByRole('option', { name: /JSON Formatter|JSON 格式化/ })).not.toBeInTheDocument();
  });

  it.each(['zh', 'en'])('在 %s 界面搜索 SVG 时名称命中排在描述命中之前，回车打开首项', async (language) => {
    const previousLanguage = i18n.language;
    await i18n.changeLanguage(language);
    const selectedTools: string[] = [];
    try {
      render(<SearchDialog onSelectTool={(id) => selectedTools.push(id)} />);
      act(() => useAppStore.getState().setSearchOpen(true));

      fireEvent.change(screen.getByRole('combobox'), { target: { value: '  sVg  ' } });

      const options = screen.getAllByRole('option');
      expect(options[0]).toHaveAttribute('id', 'tool-search-option-svg-optimizer');
      expect(options[0]).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('option', { name: /Mermaid/ })).toBeInTheDocument();

      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' });
      expect(selectedTools).toEqual(['svg-optimizer']);
    } finally {
      await act(() => i18n.changeLanguage(previousLanguage));
    }
  });

  it('支持忽略名称空格搜索中文工具名', () => {
    render(<SearchDialog onSelectTool={() => undefined} />);
    act(() => useAppStore.getState().setSearchOpen(true));

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'SVG优化' } });

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('id', 'tool-search-option-svg-optimizer');
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
