import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import '@/i18n';
import { Sidebar } from '@/components/layout/Sidebar';
import { useAppStore } from '@/store/app-store';

describe('侧栏导航', () => {
  beforeEach(() => {
    useAppStore.setState({
      sidebarCollapsed: false,
      activeCategory: null,
      activeToolId: null,
    });
  });

  it('提供分类导航语义', () => {
    render(<Sidebar onSelectTool={() => undefined} />);
    expect(screen.getByRole('navigation', { name: 'Category navigation' })).toBeInTheDocument();
  });

  it('折叠后按 Esc 关闭分类浮层', () => {
    useAppStore.setState({ sidebarCollapsed: true, activeCategory: 'data' });
    render(<Sidebar onSelectTool={() => undefined} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useAppStore.getState().activeCategory).toBeNull();
  });
});
