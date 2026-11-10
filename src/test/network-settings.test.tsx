import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { SettingsDialog } from '@/components/layout/SettingsDialog';
import { useAppStore } from '@/store/app-store';

vi.mock('@/lib/api-client', () => ({ isTauri: true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue({}) }));

describe('桌面端网络权限设置', () => {
  beforeEach(() => {
    useAppStore.setState({ networkAccessAllowed: false });
  });

  function openNetworkSettings() {
    render(
      <I18nextProvider i18n={i18n}>
        <SettingsDialog open initialTab="network" onClose={() => {}} />
      </I18nextProvider>
    );
  }

  it('默认关闭并在开启前显示风险确认', () => {
    openNetworkSettings();
    const toggle = screen.getByRole('switch', { name: i18n.t('network.allow') });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(screen.getByRole('alertdialog', { name: i18n.t('network.confirmTitle') })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('确认后开启并可关闭网络权限', () => {
    openNetworkSettings();
    fireEvent.click(screen.getByRole('switch', { name: i18n.t('network.allow') }));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('network.confirmEnable') }));

    const toggle = screen.getByRole('switch', { name: i18n.t('network.allow') });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(useAppStore.getState().networkAccessAllowed).toBe(true);

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(useAppStore.getState().networkAccessAllowed).toBe(false);
  });
});
