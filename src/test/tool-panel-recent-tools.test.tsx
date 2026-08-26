import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ToolPanel } from '@/components/layout/ToolPanel';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => ({
      'app.recentTools': '最近使用',
      'app.recentToolsEmpty': '打开工具后会显示在这里。',
    })[key] ?? (typeof fallback === 'string' ? fallback : key),
    i18n: { language: 'zh', resolvedLanguage: 'zh', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('@/components/layout/LogPanel', () => ({ LogPanel: () => null }));

describe('ToolPanel recent tools', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeToolId: null,
      activeCategory: null,
      recentToolUsage: {},
      usageSequence: 0,
    });
    useToolLifecycleStore.setState({ activeTools: [] });
  });

  it('shows an empty state before any tool is used', () => {
    render(<ToolPanel toolId={null} onOpenSettings={vi.fn()} />);

    const section = screen.getByRole('heading', { name: '最近使用' }).closest('section');
    expect(section).not.toBeNull();
    expect(within(section!).getByText('打开工具后会显示在这里。')).toBeInTheDocument();
    expect(within(section!).queryAllByRole('button')).toHaveLength(0);
  });

  it('shows no more than six tools ordered by frequency then recency', () => {
    const usage = useAppStore.getState();
    ['json-yaml', 'xml-json', 'timestamp', 'number-base', 'color-picker', 'data-size', 'angle'].forEach((id) => {
      usage.recordToolUsage(id);
    });
    usage.recordToolUsage('json-yaml');
    usage.recordToolUsage('json-yaml');

    render(<ToolPanel toolId={null} onOpenSettings={vi.fn()} />);

    const section = screen.getByRole('heading', { name: '最近使用' }).closest('section');
    const cards = within(section!).getAllByRole('button');
    expect(cards).toHaveLength(6);
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('JSON ↔ YAML'),
      expect.stringContaining('角度转换'),
      expect.stringContaining('数据单位换算'),
      expect.stringContaining('颜色与取色'),
      expect.stringContaining('进制转换'),
      expect.stringContaining('时间戳转换'),
    ]);
  });
});
