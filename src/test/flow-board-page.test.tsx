import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FlowBoard from '@/tools/graphic/flow-board/FlowBoard';
import { saveBytes, saveBytesWithFeedback } from '@/lib/file-save';
vi.mock('@/lib/file-save', () => ({ saveBytes: vi.fn(async () => '流程图.json'), saveBytesWithFeedback: vi.fn(async () => 'output') }));
vi.mock('@/lib/api-client', () => ({ isTauri: false }));
vi.mock('@/lib/local-documents', () => ({ openTextDocument: vi.fn(async () => null) }));
afterEach(cleanup);
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

describe('flowchart editor user operations', () => {
  it('exposes the standard shapes once and supports shape search', () => {
    render(<FlowBoard />);
    expect(screen.getAllByRole('button', { name: '添加 数据库' })).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText('搜索图形'), { target: { value: '数据库' } });
    expect(screen.queryByRole('button', { name: '添加 判断' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加 数据库' }));
    expect(screen.getByText('4 个图形 · 2 条连接')).toBeInTheDocument();
  });
  it('adds pages, returns to the original page and saves both page contents', async () => {
    render(<FlowBoard />);
    fireEvent.click(screen.getByRole('button', { name: '新建页面' }));
    expect(screen.getByText('0 个图形 · 0 条连接')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加 文档' }));
    fireEvent.click(screen.getByRole('tab', { name: '第 1 页' }));
    expect(screen.getByText('3 个图形 · 2 条连接')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(saveBytes).toHaveBeenCalled());
    const bytes = vi.mocked(saveBytes).mock.calls[0][1] as Uint8Array;
    const doc = JSON.parse(new TextDecoder().decode(bytes));
    expect(doc.pages.map((page: { nodes: unknown[] }) => page.nodes.length)).toEqual([3, 1]);
  });
  it('keeps keyboard deletion inside the label input and records editing as one undo', async () => {
    render(<FlowBoard />);
    fireEvent.click(screen.getByRole('button', { name: '添加 文档' }));
    const input = screen.getByLabelText('节点文本');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '已编辑' } });
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(screen.getByText('4 个图形 · 2 条连接')).toBeInTheDocument();
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByLabelText('节点文本')).toHaveValue('文档');
  });
  it('shows a functional layer panel with hide and lock controls', () => {
    render(<FlowBoard />);
    fireEvent.click(screen.getByRole('tab', { name: '图层' }));
    const panel = screen.getByRole('tabpanel', { name: '图层' });
    expect(within(panel).getByLabelText('显示 默认图层')).toBeChecked();
    fireEvent.click(within(panel).getByLabelText('锁定 默认图层'));
    expect(within(panel).getByLabelText('锁定 默认图层')).toBeChecked();
  });
  it('exports PNG and SVG through the export menu and opens import preview', () => {
    render(<FlowBoard />);
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'SVG' }));
    expect(saveBytesWithFeedback).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '从文本生成' }));
    expect(screen.getByRole('dialog', { name: '从文本生成流程图' })).toBeInTheDocument();
  });
});
