import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('renders Markdown release notes in the update page', async () => {
    check.mockResolvedValue({
      version: '1.2.2',
      body: [
        '### 新增', '',
        '- 支持 **Markdown** 更新说明',
        '- 使用 `Alt+Q` 截图', '',
        '### 改进', '',
        '1. 下载更新', '2. 安装更新', '',
        '> 更新后生效', '',
        '```text', 'npm run build', '```', '',
        '| 功能 | 状态 |', '| --- | --- |', '| 更新说明 | 已支持 |', '',
        '[查看发行说明](https://github.com/PeterPandefu/Niuery-Toolkit/releases)',
      ].join('\r\n'),
      downloadAndInstall: vi.fn(),
    });
    openUpdates();
    await checkUpdates();

    expect(screen.getByRole('heading', { level: 3, name: '新增' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '改进' })).toBeInTheDocument();
    expect(screen.getByText('Markdown').tagName).toBe('STRONG');
    expect(screen.getByText('Alt+Q').tagName).toBe('CODE');
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText('下载更新').closest('ol')).toBeInTheDocument();
    expect(screen.getByText('更新后生效').closest('blockquote')).toBeInTheDocument();
    expect(screen.getByText('npm run build').closest('pre')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByRole('cell', { name: '已支持' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '查看发行说明' });
    expect(link).toHaveAttribute('href', 'https://github.com/PeterPandefu/Niuery-Toolkit/releases');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: i18n.t('updates.install') })).toBeEnabled();
  });

  it('escapes raw HTML and rejects executable links in release notes', async () => {
    check.mockResolvedValue({
      version: '1.2.2',
      body: '<img src="x" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[危险链接](javascript:alert(1))',
      downloadAndInstall: vi.fn(),
    });
    openUpdates();
    await checkUpdates();

    expect(screen.getByText('<img src="x" onerror="alert(1)">')).toBeInTheDocument();
    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '危险链接' })).not.toBeInTheDocument();
  });

  it('allows an available update without release notes', async () => {
    check.mockResolvedValue({ version: '1.2.2', downloadAndInstall: vi.fn() });
    openUpdates();
    await checkUpdates();

    expect(screen.getByText(i18n.t('updates.available', { version: '1.2.2' }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('updates.install') })).toBeEnabled();
  });
});
