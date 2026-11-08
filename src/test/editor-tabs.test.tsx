import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  return (
    <>
      <output data-testid="active-content">{tabs.content}</output>
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
