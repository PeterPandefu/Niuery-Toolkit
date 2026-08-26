import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FileUnlocker from '@/tools/system/file-unlocker';
import PortProcessKiller from '@/tools/system/port-process-killer';

const { invokeMock, toastError, toastSuccess, tauri } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  tauri: { available: true },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@/lib/api-client', () => ({
  get isTauri() {
    return tauri.available;
  },
}));
vi.mock('@/hooks/use-tool-logger', () => ({
  useToolLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

const owner = {
  target: { pid: 9527, creationTime: 101 },
  name: 'node.exe',
  executablePath: 'C:\\Program Files\\nodejs\\node.exe',
  endpoints: [{ protocol: 'tcp', localAddress: '127.0.0.1:5173', state: 'listen' }],
};

describe('Windows process tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tauri.available = true;
  });

  it('rejects port zero before looking up an owner', async () => {
    render(<PortProcessKiller />);

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));

    expect(invokeMock).not.toHaveBeenCalled();
    expect(await screen.findByText('端口必须在 1 到 65535 之间')).toBeInTheDocument();
  });

  it('shows discovered processes and waits for confirmation before terminating', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'find_port_owners') return Promise.resolve([owner]);
      if (command === 'terminate_processes') {
        return Promise.resolve([{ pid: 9527, status: 'terminated', message: null }]);
      }
      return Promise.reject(new Error(`未知命令：${command}`));
    });
    render(<PortProcessKiller />);

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));

    expect(await screen.findByText('node.exe')).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:5173/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '结束占用进程' }));
    expect(screen.getByRole('dialog', { name: '确认结束进程' })).toHaveTextContent('PID 9527');
    expect(invokeMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));

    await waitFor(() => expect(invokeMock).toHaveBeenLastCalledWith('terminate_processes', {
      targets: [{ pid: 9527, creationTime: 101 }],
    }));
    expect(await screen.findByText('已结束 1 个进程')).toBeInTheDocument();
  });

  it('clears a port lookup when the requested target changes', async () => {
    invokeMock.mockResolvedValueOnce([owner]);
    render(<PortProcessKiller />);

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    expect(await screen.findByText('node.exe')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '8080' } });

    expect(screen.queryByText('node.exe')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '结束占用进程' })).not.toBeInTheDocument();
  });

  it('closes the confirmation when the queried port changes', async () => {
    invokeMock.mockResolvedValueOnce([owner]);
    render(<PortProcessKiller />);

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    await screen.findByText('node.exe');
    fireEvent.click(screen.getByRole('button', { name: '结束占用进程' }));
    expect(screen.getByRole('dialog', { name: '确认结束进程' })).toHaveTextContent('查询目标：端口 5173');

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '8080' } });

    expect(screen.queryByRole('dialog', { name: '确认结束进程' })).not.toBeInTheDocument();
  });

  it('discards an in-flight port lookup after the target changes', async () => {
    let resolveLookup: (owners: typeof owner[]) => void;
    invokeMock.mockImplementationOnce(() => new Promise<typeof owner[]>((resolve) => {
      resolveLookup = resolve;
    }));
    render(<PortProcessKiller />);

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '8080' } });
    resolveLookup!([owner]);

    await waitFor(() => expect(screen.queryByText('node.exe')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '结束占用进程' })).not.toBeInTheDocument();
  });

  it('rechecks a file after termination before reporting it unlocked', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'pick_existing_file') return Promise.resolve('C:\\work\\locked.dll');
      if (command === 'find_file_lock_owners') {
        return invokeMock.mock.calls.filter(([name]) => name === 'find_file_lock_owners').length === 1
          ? Promise.resolve([owner])
          : Promise.resolve([]);
      }
      if (command === 'terminate_processes') {
        return Promise.resolve([{ pid: 9527, status: 'terminated', message: null }]);
      }
      return Promise.reject(new Error(`未知命令：${command}`));
    });
    render(<FileUnlocker />);

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    await waitFor(() => expect(screen.getByLabelText('文件路径')).toHaveValue('C:\\work\\locked.dll'));
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    expect(await screen.findByText('node.exe')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '解除文件占用' }));
    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));

    expect(await screen.findByText('文件已解除占用')).toBeInTheDocument();
    expect(invokeMock.mock.calls.filter(([command]) => command === 'find_file_lock_owners')).toHaveLength(2);
  });

  it('does not expose native actions in a browser preview', () => {
    tauri.available = false;
    render(<PortProcessKiller />);

    expect(screen.getByText('该功能仅在 Tauri 桌面端可用')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
