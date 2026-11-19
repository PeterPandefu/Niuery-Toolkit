import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorTabs } from '@/components/shared/EditorTabs';
import { useEditorTabs } from '@/hooks/use-editor-tabs';

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function Harness() {
  const tabs = useEditorTabs({
    storageKey: 'test-editor-tabs',
    legacyStorageKey: 'test-editor-draft',
    defaultContent: '默认内容',
    extension: 'md',
    defaultPrefix: '未命名',
    maxTabs: 20,
  });
  const [imported, setImported] = useState(0);
  return (
    <>
      <output data-testid="active-content">{tabs.content}</output>
      <output data-testid="imported-count">{imported}</output>
      <button onClick={() => setImported(tabs.importTabs([
        { name: '文档.md', content: '甲' },
        { name: '文档.md', content: '乙' },
        { name: '第三.md', content: '丙' },
      ]).length)}>批量导入</button>
      <button onClick={() => setImported(tabs.importTabs(
        Array.from({ length: 25 }, (_, index) => ({ name: `批量-${index + 1}.md`, content: `内容 ${index + 1}` })),
      ).length)}>批量导入超限</button>
      <EditorTabs
        tabs={tabs.tabs}
        activeTabId={tabs.activeTabId}
        onActivate={tabs.activateTab}
        onCreate={() => tabs.createTab()}
        onDuplicate={(id) => tabs.duplicateTab(id)}
        onRename={tabs.renameTab}
        onClose={tabs.closeTab}
        onCloseOthers={tabs.closeOthers}
        onCloseRight={tabs.closeToRight}
        onCloseAll={tabs.closeAll}
        onReorder={tabs.reorderTabs}
      />
    </>
  );
}

describe('编辑器页签', () => {
  it('从旧草稿迁移，并支持新建、切换和关闭', () => {
    localStorage.setItem('test-editor-draft', '旧内容');
    render(<Harness />);
    expect(screen.getByTestId('active-content')).toHaveTextContent('旧内容');
    fireEvent.click(screen.getByRole('button', { name: '新建页签' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByTestId('active-content')).toHaveTextContent('默认内容');
    fireEvent.click(screen.getByRole('tab', { name: '未命名-1.md' }));
    expect(screen.getByTestId('active-content')).toHaveTextContent('旧内容');
    fireEvent.click(screen.getByRole('button', { name: '关闭 未命名-1.md' }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('损坏的新结构回退旧草稿，关闭全部仍保留当前页签', () => {
    localStorage.setItem('test-editor-tabs', '{bad json');
    localStorage.setItem('test-editor-draft', '可恢复内容');
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '新建页签' }));
    fireEvent.click(screen.getByRole('tab', { name: '未命名-2.md' }));
    fireEvent.contextMenu(screen.getByRole('tab', { name: '未命名-2.md' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭全部' }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByTestId('active-content')).toHaveTextContent('默认内容');
  });

  it('批量导入为每个文件建页签，重名自动去重并激活最后一个', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '批量导入' }));
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: '文档.md' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '文档-2.md' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '第三.md' })).toBeInTheDocument();
    expect(screen.getByTestId('active-content')).toHaveTextContent('丙');
    expect(screen.getByTestId('imported-count')).toHaveTextContent('3');
  });

  it('批量导入超出页签上限时只导入可容纳的部分', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '批量导入超限' }));
    expect(screen.getAllByRole('tab')).toHaveLength(20);
    expect(screen.getByTestId('imported-count')).toHaveTextContent('19');
    expect(screen.getByTestId('active-content')).toHaveTextContent('内容 19');
  });

  it('重命名时保证同类页签名称唯一', () => {
    render(<Harness />);
    fireEvent.doubleClick(screen.getByRole('tab', { name: '未命名-1.md' }));
    const input = screen.getByLabelText('重命名页签');
    fireEvent.change(input, { target: { value: '文档.md' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: '新建页签' }));
    fireEvent.doubleClick(screen.getByRole('tab', { name: '未命名-1.md' }));
    fireEvent.change(screen.getByLabelText('重命名页签'), { target: { value: '文档.md' } });
    fireEvent.keyDown(screen.getByLabelText('重命名页签'), { key: 'Enter' });
    expect(screen.getByRole('tab', { name: '文档-2.md' })).toBeInTheDocument();
  });
});
