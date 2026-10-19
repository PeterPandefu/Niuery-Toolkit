import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { SettingsDialog } from '@/components/layout/SettingsDialog';

const { check } = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ isTauri: true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue({}) }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));

function openUpdates() {
  render(<I18nextProvider i18n={i18n}><SettingsDialog open initialTab="updates" onClose={() => {}} /></I18nextProvider>);
}

async function checkUpdates() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: i18n.t('updates.check') }));
  });
}

describe('software update status', () => {
  beforeEach(() => { check.mockReset(); });

  it('does not claim to be up to date before a check succeeds', () => {
    openUpdates();
    expect(screen.queryByText(i18n.t('updates.noUpdate'))).not.toBeInTheDocument();
  });

  it('shows a failed check without claiming to be up to date', async () => {
    check.mockRejectedValue('Could not fetch a valid release JSON from the remote');
    openUpdates();
    await checkUpdates();
    expect(screen.getByText('Could not fetch a valid release JSON from the remote')).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('updates.noUpdate'))).not.toBeInTheDocument();
  });

  it('shows up to date only after a successful check returns no update', async () => {
    check.mockResolvedValue(null);
    openUpdates();
    await checkUpdates();
    expect(screen.getByText(i18n.t('updates.noUpdate'))).toBeInTheDocument();
  });

  it('clears a previous up-to-date result when a later check fails', async () => {
    check.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('HTTP 404'));
    openUpdates();
    await checkUpdates();
    expect(screen.getByText(i18n.t('updates.noUpdate'))).toBeInTheDocument();
    await checkUpdates();
    expect(screen.getByText('HTTP 404')).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('updates.noUpdate'))).not.toBeInTheDocument();
  });

  it('keeps an available update visible when installation fails', async () => {
    check.mockResolvedValue({
      version: '1.2.1', body: '修复问题',
      downloadAndInstall: vi.fn().mockRejectedValue(new Error('Download failed')),
    });
    openUpdates();
    await checkUpdates();
    expect(screen.getByText(i18n.t('updates.available', { version: '1.2.1' }))).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: i18n.t('updates.install') })));
    expect(await screen.findByText('Download failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('updates.install') })).toBeEnabled();
    expect(screen.queryByText(i18n.t('updates.noUpdate'))).not.toBeInTheDocument();
  });
});
