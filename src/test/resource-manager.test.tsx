import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import '@/i18n';
import { ResourceNotice } from '@/components/resources/ResourceNotice';
import { ResourceManager } from '@/components/resources/ResourceManager';
import { useResourceStore } from '@/store/resource-store';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (v: string) => v }));
const missing = { id: 'chromium' as const, version: '1234', platform: 'windows-x86_64', archive: 'pack.zip', entry: 'browser.exe', sha256: 'a'.repeat(64), downloadBytes: 100, installedBytes: 200, status: 'missing' as const, source: null, path: null, error: null, managed: false };
beforeEach(() => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  invoke.mockReset();
  invoke.mockImplementation((command: string) => Promise.resolve(command === 'list_resources' ? [missing] : ''));
  useResourceStore.setState({ resources: [missing], loading: false, error: null, busy: {}, errors: {}, progress: {} });
});
afterEach(() => { Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); });

it('offers management without downloading or hiding the tool', async () => {
  const open = vi.fn(); window.addEventListener('open-resource-manager', open);
  render(<><ResourceNotice ids={['chromium']} /><textarea aria-label="document" defaultValue="draft" /></>);
  await screen.findByRole('button', { name: /管理资源|Manage resources/i });
  fireEvent.click(screen.getByRole('button', { name: /管理资源|Manage resources/i }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('document')).toHaveValue('draft');
  expect(invoke.mock.calls.some(([command]) => command === 'install_resource')).toBe(false);
  window.removeEventListener('open-resource-manager', open);
});

it('shows failed download and allows retry without erasing state', async () => {
  invoke.mockImplementation((command: string) => command === 'install_resource' ? Promise.reject('network unavailable') : Promise.resolve(command === 'list_resources' ? [missing] : ''));
  render(<ResourceManager />);
  fireEvent.click(await screen.findByRole('button', { name: /^(下载|Download)$/ }));
  await waitFor(() => expect(screen.getByText('network unavailable')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /^(下载|Download)$/ })).toBeEnabled();
  expect(screen.getByRole('button', { name: /离线导入|Offline import/ })).toBeEnabled();
});

it('opens the same manager inside the standalone screenshot window', async () => {
  window.location.hash = '#/screenshot';
  try {
    render(<ResourceNotice ids={['ocr-engine']} />);
    fireEvent.click(await screen.findByRole('button', { name: /管理资源|Manage resources/i }));
    expect(await screen.findByRole('dialog', { name: /资源管理|Resources/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /离线导入|Offline import/ })).toBeEnabled();
  } finally { window.location.hash = ''; }
});
