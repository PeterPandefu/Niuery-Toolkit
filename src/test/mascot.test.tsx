import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { ToolPanel } from '@/components/layout/ToolPanel';
import * as mascotLines from '@/lib/mascot-lines';
import { pickMascotLine } from '@/lib/mascot-lines';
import { useAppStore } from '@/store/app-store';
import { useToolLifecycleStore } from '@/store/tool-lifecycle-store';

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'system', setTheme: vi.fn() }),
}));

vi.mock('@/components/layout/LogPanel', () => ({ LogPanel: () => null }));

function renderWelcome() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ToolPanel toolId={null} onOpenSettings={vi.fn()} />
    </I18nextProvider>
  );
}

describe('吉祥物提示', () => {
  it('不按固定顺序轮播', () => {
    expect(pickMascotLine(15, 0, () => 0)).toBe(1);
    expect(pickMascotLine(15, 0, () => 0.5)).toBe(8);
    expect(pickMascotLine(15, 0, () => 0.99)).not.toBe(1);
    expect(pickMascotLine(15, 3, () => 0.5)).not.toBe(3);
  });
});

describe('欢迎页吉祥物', () => {
  let previousLanguage = i18n.language;

  afterEach(async () => {
    vi.unstubAllGlobals();
    await i18n.changeLanguage(previousLanguage);
  });

  beforeEach(async () => {
    previousLanguage = i18n.language;
    await i18n.changeLanguage('zh');
    useAppStore.setState({
      activeToolId: null,
      activeCategory: null,
      recentToolUsage: {},
      usageSequence: 0,
      mascotEnabled: true,
    });
    useToolLifecycleStore.setState({ activeTools: [] });
  });

  it('不再显示工作区概览，并给出可点击的牛儿', async () => {
    renderWelcome();

    expect(screen.queryByText('工作区概览')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '工具概览' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '吉祥物' })).toBeInTheDocument();
    const mascot = screen.getByRole('button', { name: '逗一逗牛儿' });
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 48, clientY: 24 });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const pupil = mascot.querySelector('.mascot-pupil');
    expect(pupil?.getAttribute('transform')).not.toBe('translate(0 0)');
  });

  it('点击后轮换提示，且减弱动态时不跟随指针', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: String(query).includes('reduce'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })));

    renderWelcome();
    const mascot = screen.getByRole('button', { name: '逗一逗牛儿' });
    expect(mascot).toHaveAttribute('data-reduced-motion', 'true');

    fireEvent.pointerMove(window, { clientX: 12, clientY: 12 });
    for (const pupil of mascot.querySelectorAll('.mascot-pupil')) {
      expect(pupil).toHaveAttribute('transform', 'translate(0 0)');
    }

    expect(screen.queryByText(/拖动后松手会掉下去/)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(mascot);
    expect(screen.getByRole('status')).toBeInTheDocument();

    fireEvent.pointerDown(mascot, { button: 0, pointerId: 1, buttons: 1 });
    expect(mascot).toHaveAttribute('data-pose', 'pet');
    fireEvent.pointerMove(mascot, { pointerId: 1, buttons: 1, movementX: 14, movementY: 4 });
    fireEvent.pointerUp(mascot, { pointerId: 1 });
  });

  it('拖向区域外时停在隐形墙上并被挤扁', () => {
    renderWelcome();
    const mascot = screen.getByRole('button', { name: '逗一逗牛儿' });
    const arena = mascot.parentElement as HTMLElement;
    Object.defineProperty(arena, 'clientWidth', { configurable: true, value: 288 });
    Object.defineProperty(arena, 'clientHeight', { configurable: true, value: 416 });
    Object.defineProperty(mascot, 'offsetWidth', { configurable: true, value: 144 });
    Object.defineProperty(mascot, 'offsetHeight', { configurable: true, value: 160 });

    fireEvent.pointerDown(mascot, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(mascot, { pointerId: 1, clientX: 400, clientY: -300 });

    expect(Number(mascot.getAttribute('data-x'))).toBeLessThanOrEqual(66);
    expect(Number(mascot.getAttribute('data-y'))).toBeGreaterThanOrEqual(-122);
    expect(Number(mascot.getAttribute('data-squash-x'))).toBeLessThan(1);
    expect(Number(mascot.getAttribute('data-squash-y'))).toBeLessThan(1);

    fireEvent.pointerUp(mascot, { pointerId: 1 });
    expect(mascot).toHaveAttribute('data-squash-x', '1');
    expect(mascot).toHaveAttribute('data-squash-y', '1');
    expect(Number(mascot.getAttribute('data-x'))).toBeLessThanOrEqual(66);
    expect(Number(mascot.getAttribute('data-y'))).toBeGreaterThanOrEqual(-122);
  });

  it('点击后随机换一句，5 秒没人理就收起气泡', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pick = vi.spyOn(mascotLines, 'pickMascotLine');
    pick.mockReturnValueOnce(0);
    pick.mockReturnValueOnce(4);
    renderWelcome();
    const mascot = screen.getByRole('button', { name: '逗一逗牛儿' });
    expect(screen.getByRole('status')).toHaveTextContent('JSON、YAML、XML');

    act(() => { vi.advanceTimersByTime(4000); });
    fireEvent.pointerDown(mascot, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(mascot, { pointerId: 1 });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByRole('status')).toHaveTextContent('JSON、YAML、XML');

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    fireEvent.click(mascot);
    expect(screen.getByRole('status')).toHaveTextContent('哈希、校验和、密码');
    expect(screen.queryByText('你要和我一起玩游戏吗？')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('点「是」后右侧换成冲栏，退出后回到牛儿', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    vi.spyOn(mascotLines, 'pickMascotLine').mockReturnValue(mascotLines.MASCOT_LINE_KEYS.indexOf(mascotLines.MASCOT_PLAY_LINE));
    renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: '是' }));

    expect(screen.queryByRole('button', { name: '逗一逗牛儿' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '冲栏' })).toBeInTheDocument();
    expect(screen.getByText('0 米')).toBeInTheDocument();
    expect(screen.getByText('左右躲开栏杆')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(screen.getByRole('button', { name: '逗一逗牛儿' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '冲栏' })).not.toBeInTheDocument();
  });

  it('关闭后欢迎页不再显示吉祥物', () => {
    useAppStore.setState({ mascotEnabled: false });
    renderWelcome();
    expect(screen.queryByRole('button', { name: '逗一逗牛儿' })).not.toBeInTheDocument();
  });

  it('欢迎页活动区随窗口伸展，而不是锁在固定列宽里', () => {
    renderWelcome();
    const grid = document.querySelector('[data-welcome-grid]');
    expect(grid?.className).toContain('grid-rows-[minmax(0,1fr)]');
    expect(grid?.className).toContain('minmax(18rem,1fr)');
    expect(grid?.className).toContain('lg:max-w-none');
  });
});
