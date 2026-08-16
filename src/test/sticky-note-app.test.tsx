import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StickyNoteApp from '@/sticky-note/StickyNoteApp';

const { invokeMock, applyThemeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  applyThemeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/lib/api-client', () => ({ isTauri: true }));
vi.mock('@/hooks/use-theme', () => ({ useApplyTheme: applyThemeMock }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('StickyNoteApp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockImplementation((command: string) => {
      if (command === 'get_sticky_notes') {
        return Promise.resolve({
          notes: [{ id: 'note-1', title: '便签 1', content: '先完成便签', color: 'lime' }],
          activeId: 'note-1',
          alwaysOnTop: true,
        });
      }
      return Promise.resolve();
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    invokeMock.mockReset();
    applyThemeMock.mockReset();
  });

  it('加载本地内容，并在编辑后自动保存', async () => {
    render(<StickyNoteApp />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const editor = screen.getByRole('textbox', { name: 'stickyNote.editorLabel' });
    expect(editor).toHaveValue('先完成便签');

    fireEvent.change(editor, { target: { value: '更新后的内容' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(invokeMock).toHaveBeenCalledWith('update_sticky_notes', {
      document: {
        notes: [{ id: 'note-1', title: '便签 1', content: '更新后的内容', color: 'lime' }],
        activeId: 'note-1',
        alwaysOnTop: true,
      },
    });
    expect(applyThemeMock).toHaveBeenCalled();
  });

  it('为当前便签标记同色连接点所需的活动标签信息', async () => {
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const activeTab = screen.getByRole('button', { name: '便签 1' });
    const activeRow = activeTab.closest('.sticky-note-tab-row');
    expect(activeRow).toHaveClass('is-active');
    expect(activeRow).toHaveStyle({ '--tab-surface': '#DDF7A5', '--tab-border': '#97C65C' });
  });

  it('能切换颜色、置顶状态并隐藏窗口', async () => {
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'stickyNote.colors.pink' }));
    fireEvent.click(screen.getByRole('button', { name: 'stickyNote.unpin' }));
    fireEvent.click(screen.getByRole('button', { name: 'stickyNote.hide' }));

    expect(screen.getByRole('button', { name: 'stickyNote.colors.pink' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'stickyNote.pin' })).toHaveAttribute('aria-pressed', 'false');
    expect(invokeMock).toHaveBeenCalledWith('set_sticky_note_always_on_top', { alwaysOnTop: false });
    expect(invokeMock).toHaveBeenCalledWith('hide_sticky_note');
  });

  it('通过 Rust 命令拖动自定义标题栏，交互按钮不会吞掉拖动区域', async () => {
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const header = document.querySelector('.sticky-note-header');
    const dragRegion = document.querySelector('.sticky-note-drag-handle');
    expect(header).not.toBeNull();
    expect(dragRegion).not.toBeNull();
    expect(header?.querySelector('[data-note-control]')).not.toBeNull();

    fireEvent.mouseDown(dragRegion!);
    expect(invokeMock).toHaveBeenCalledWith('start_sticky_note_drag');

    invokeMock.mockClear();
    fireEvent.mouseDown(screen.getAllByRole('button', { name: 'stickyNote.add' })[1]);
    expect(invokeMock).not.toHaveBeenCalledWith('start_sticky_note_drag');
  });

  it('鼠标进入贴边后露出的区域时请求展开便签', async () => {
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    invokeMock.mockClear();
    fireEvent.mouseEnter(document.querySelector('.sticky-note-shell')!);

    expect(invokeMock).toHaveBeenCalledWith('expand_sticky_note_from_edge');
  });

  it('顶部和左侧均提供新增便签入口，左侧新增后自动定位到新标签', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getAllByRole('button', { name: 'stickyNote.add' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'stickyNote.add' })[0]);
    expect(document.querySelectorAll('.sticky-note-tab')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '便签 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('新增便签按照随机结果使用预设颜色，而非固定暖黄', async () => {
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'stickyNote.add' })[0]);
    expect(screen.getByRole('button', { name: '便签 2' })).toHaveStyle({ backgroundColor: '#FFD0E2' });
    random.mockRestore();
  });

  it('通过右键菜单删除当前便签后会切换到相邻便签，最后一张便签不可删除', async () => {
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'stickyNote.add' })[0]);
    expect(document.querySelectorAll('.sticky-note-tab')).toHaveLength(2);

    fireEvent.contextMenu(screen.getByRole('button', { name: '便签 2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'stickyNote.delete' }));
    expect(document.querySelectorAll('.sticky-note-tab')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '便签 1' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.contextMenu(screen.getByRole('button', { name: '便签 1' }));
    expect(screen.getByRole('menuitem', { name: 'stickyNote.delete' })).toBeDisabled();
  });

  it('删除非当前便签时保持当前便签不变', async () => {
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const addButtons = screen.getAllByRole('button', { name: 'stickyNote.add' });
    fireEvent.click(addButtons[0]);
    fireEvent.click(addButtons[0]);

    fireEvent.contextMenu(screen.getByRole('button', { name: '便签 1' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'stickyNote.delete' }));

    expect(document.querySelectorAll('.sticky-note-tab')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '便签 3' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('可从右键菜单重命名便签', async () => {
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'stickyNote.add' })[0]);
    fireEvent.contextMenu(screen.getByRole('button', { name: '便签 2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'stickyNote.rename' }));

    const titleInput = screen.getByRole('textbox', { name: 'stickyNote.title' });
    fireEvent.change(titleInput, { target: { value: '项目记录' } });
    fireEvent.keyDown(titleInput, { key: 'Enter' });

    expect(screen.getByRole('button', { name: '项目记录' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('支持通过键盘菜单键打开右键菜单，并将焦点移入首个操作', async () => {
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'stickyNote.add' })[0]);
    fireEvent.keyDown(screen.getByRole('button', { name: '便签 2' }), { key: 'ContextMenu' });

    const renameButton = screen.getByRole('menuitem', { name: 'stickyNote.rename' });
    expect(renameButton).toHaveFocus();
  });

  it('可切换时间轴模式，并通过顶部加号新增时间轴记录', async () => {
    render(<StickyNoteApp />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'stickyNote.toggleMode' }));
    expect(screen.getByLabelText('stickyNote.timeline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'stickyNote.addTimelineEntry' }));
    expect(screen.getByRole('textbox', { name: 'stickyNote.editorLabel' })).toHaveValue('先完成便签\n');
  });
});
