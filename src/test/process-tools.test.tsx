import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ResourceUnlocker from '@/tools/system/resource-unlocker';
import { ProcessToolPage } from '@/tools/system/process-tool-page';

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
  target: { pid: 9527, creationTime: '134052868280123457' },
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
    render(<ResourceUnlocker />);

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));

    expect(invokeMock).not.toHaveBeenCalled();
    expect(await screen.findByText('端口必须在 1 到 65535 之间')).toBeInTheDocument();
  });

  it('shows discovered processes and waits for confirmation before terminating', async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === 'find_port_owners') return Promise.resolve(invokeMock.mock.calls.filter(([name]) => name === command).length === 1 ? [owner] : []);
      if (command === 'terminate_processes') {
        return Promise.resolve([{ pid: 9527, status: 'terminated', message: null }]);
      }
      return Promise.reject(new Error(`未知命令：${command}`));
    });
    render(<ResourceUnlocker />);

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));

    expect(await screen.findByText('node.exe')).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:5173/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '结束占用进程' }));
    expect(screen.getByRole('dialog', { name: '确认结束进程' })).toHaveTextContent('PID 9527');
    expect(invokeMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('terminate_processes', {
      targets: [{ pid: 9527, creationTime: '134052868280123457' }],
    }));
    expect(await screen.findByText('端口已解除占用')).toBeInTheDocument();
  });

  it('clears a port lookup when the requested target changes', async () => {
    invokeMock.mockResolvedValueOnce([owner]);
    render(<ResourceUnlocker />);

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    expect(await screen.findByText('node.exe')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '8080' } });

    expect(screen.queryByText('node.exe')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '结束占用进程' })).not.toBeInTheDocument();
  });

  it('closes the confirmation when the queried port changes', async () => {
    invokeMock.mockResolvedValueOnce([owner]);
    render(<ResourceUnlocker />);

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
    render(<ResourceUnlocker />);

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
    render(<ProcessToolPage kind="file" />);

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
    render(<ResourceUnlocker />);

    expect(screen.getByText('该功能仅在 Tauri 桌面端可用')).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it.each(['-1', '65536', '1.5', 'abc', ''])( '拒绝无效端口 %s', (value) => {
    render(<ResourceUnlocker />);
    fireEvent.change(screen.getByLabelText('端口号'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    expect(invokeMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('端口必须在 1 到 65535 之间');
  });

  it.each([
    ['端口', '端口号', '5173', 'find_port_owners', '结束占用进程'],
    ['文件', '文件路径', 'C:\\测试\\文件.txt', 'find_file_lock_owners', '解除文件占用'],
    ['文件夹', '文件夹路径', 'C:\\测试\\目录', 'find_folder_lock_owners', '解除文件夹占用'],
  ])('%s 模式执行确认、结束和复查的完整流程', async (mode, label, value, command, action) => {
    let queried = false;
    invokeMock.mockImplementation((name: string) => {
      if (name === command) { const owners = queried ? [] : [owner]; queried = true; return Promise.resolve(owners); }
      if (name === 'terminate_processes') return Promise.resolve([{ pid: owner.target.pid, status: 'terminated', message: null }]);
      return Promise.reject(new Error(`未知命令：${name}`));
    });
    render(<ResourceUnlocker />);
    fireEvent.click(screen.getByRole('button', { name: mode }));
    expect(screen.getByRole('button', { name: mode })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    await screen.findByText('node.exe');
    expect(invokeMock).toHaveBeenCalledWith(command, mode === '端口' ? { port: 5173 } : { path: value });
    fireEvent.click(screen.getByRole('button', { name: action }));
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toHaveTextContent(value);
    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));
    expect(await screen.findByText(`${mode}已解除占用`)).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith('terminate_processes', { targets: [owner.target] });
    expect(invokeMock.mock.calls.filter(([name]) => name === command)).toHaveLength(2);
    expect(screen.queryByText('node.exe')).not.toBeInTheDocument();
  });

  it('选择文件夹并保留取消选择前的路径', async () => {
    invokeMock.mockResolvedValueOnce('C:\\中文目录').mockResolvedValueOnce(null);
    render(<ResourceUnlocker />);
    fireEvent.click(screen.getByRole('button', { name: '文件夹' }));
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
    await waitFor(() => expect(screen.getByLabelText('文件夹路径')).toHaveValue('C:\\中文目录'));
    expect(invokeMock).toHaveBeenCalledWith('pick_existing_folder');
    fireEvent.click(screen.getByRole('button', { name: '选择文件夹' }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('文件夹路径')).toHaveValue('C:\\中文目录');
  });

  it('切换模式后丢弃旧查询，且可以继续发起查询', async () => {
    let resolveLookup!: (owners: typeof owner[]) => void;
    invokeMock.mockImplementationOnce(() => new Promise<typeof owner[]>((resolve) => { resolveLookup = resolve; }));
    render(<ResourceUnlocker />);
    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    fireEvent.click(screen.getByRole('button', { name: '文件夹' }));
    await act(async () => { resolveLookup([owner]); });
    expect(screen.queryByText('node.exe')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查找占用进程' })).toBeEnabled();
    expect(screen.getByLabelText('文件夹路径')).toHaveValue('');
  });

  it('修改查询目标后立即允许新查询，忽略旧目标的迟到响应', async () => {
    let resolveLookup!: (owners: typeof owner[]) => void;
    invokeMock.mockImplementationOnce(() => new Promise<typeof owner[]>((resolve) => { resolveLookup = resolve; }))
      .mockResolvedValueOnce([]);
    render(<ResourceUnlocker />);
    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '8080' } });
    expect(screen.getByRole('button', { name: '查找占用进程' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    await screen.findByText('未找到占用该目标的本地进程。');
    await act(async () => { resolveLookup([owner]); });
    expect(screen.queryByText('node.exe')).not.toBeInTheDocument();
  });

  it.each(['port', 'file', 'folder'] as const)('%s 复查仍被占用时不报告成功', async (kind) => {
    invokeMock.mockImplementation((command: string) => command === 'terminate_processes'
      ? Promise.resolve([{ pid: owner.target.pid, status: 'accessDenied', message: null }])
      : Promise.resolve([owner]));
    render(<ProcessToolPage kind={kind} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: kind === 'port' ? '5173' : 'C:\\测试' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    await screen.findByText('node.exe');
    fireEvent.click(screen.getByRole('button', { name: kind === 'port' ? '结束占用进程' : kind === 'file' ? '解除文件占用' : '解除文件夹占用' }));
    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));
    expect(await screen.findByText(/仍有 1 个进程占用/)).toBeInTheDocument();
    expect(screen.getByText(/访问被拒绝/)).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('复查失败保留逐项结果并提示失败', async () => {
    invokeMock.mockResolvedValueOnce([owner])
      .mockResolvedValueOnce([{ pid: owner.target.pid, status: 'terminated', message: null }])
      .mockRejectedValueOnce('无法读取文件夹');
    render(<ProcessToolPage kind="folder" />);
    fireEvent.change(screen.getByLabelText('文件夹路径'), { target: { value: 'C:\\测试' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    await screen.findByText('node.exe');
    fireEvent.click(screen.getByRole('button', { name: '解除文件夹占用' }));
    fireEvent.click(screen.getByRole('button', { name: '确认结束' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('操作或占用复查失败：无法读取文件夹');
    expect(screen.getByRole('region', { name: '结束结果' })).toHaveTextContent('已结束');
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('无法验证进程身份时禁用结束操作', async () => {
    invokeMock.mockResolvedValueOnce([{ ...owner, target: { ...owner.target, creationTime: '0' } }]);
    render(<ResourceUnlocker />);
    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    await screen.findByText('node.exe');
    expect(screen.getByRole('button', { name: '结束占用进程' })).toBeDisabled();
  });

  it('支持通过 Escape 取消确认并恢复焦点', async () => {
    invokeMock.mockResolvedValueOnce([owner]);
    render(<ResourceUnlocker />);
    fireEvent.change(screen.getByLabelText('端口号'), { target: { value: '5173' } });
    fireEvent.click(screen.getByRole('button', { name: '查找占用进程' }));
    await screen.findByText('node.exe');
    const trigger = screen.getByRole('button', { name: '结束占用进程' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: '关闭确认' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
