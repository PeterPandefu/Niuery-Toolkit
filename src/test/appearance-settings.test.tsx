import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { SettingsDialog } from '@/components/layout/SettingsDialog';
import { useAppStore } from '@/store/app-store';

vi.mock('@/lib/api-client', () => ({ isTauri: false }));

describe('外观设置', () => {
  it('打开外观页不会崩溃', () => {
    useAppStore.setState({
      theme: 'system',
      skin: 'forge',
      atmosphere: 'on',
      pointerEffect: 'glow',
    });

    render(
      <I18nextProvider i18n={i18n}>
        <SettingsDialog open onClose={() => {}} />
      </I18nextProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /外观|Appearance/ }));
    expect(screen.getByText(/指针特效|Pointer effect/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /吉祥物|Mascot/ })).toBeChecked();
    expect(screen.getByText(/流苏|Tassel/)).toBeInTheDocument();
    expect(screen.getByText(/光晕|Glow/)).toBeInTheDocument();
  });

  it('缺少指针特效字段时仍能打开外观页', () => {
    useAppStore.setState({ pointerEffect: undefined } as never);

    render(
      <I18nextProvider i18n={i18n}>
        <SettingsDialog open onClose={() => {}} />
      </I18nextProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /外观|Appearance/ }));
    expect(screen.getByText(/指针特效|Pointer effect/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /光晕|Glow/ })).toHaveAttribute('aria-pressed', 'true');
  });
});
