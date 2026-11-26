import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AiSettings } from '@/tools/ai-assistant/settings';
import type { AiBackend, AiMediaService, AiMcpServer, AiSearchService } from '@/tools/ai-assistant/types';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `http://asset.localhost/${encodeURIComponent(path)}`,
}));

function setup(searchService?: AiSearchService) {
  const saveSearchService = vi.fn(async (config: AiSearchService, apiKey?: string) => ({
    ...config,
    hasApiKey: apiKey === undefined ? config.hasApiKey : apiKey.length > 0,
  }));
  const testSearchService = vi.fn(async () => '搜索服务连接成功');
  const saveMediaService = vi.fn(async (config: AiMediaService, apiKey?: string) => ({
    ...config,
    hasApiKey: apiKey === undefined ? config.hasApiKey : apiKey.length > 0,
  }));
  const saveMcpServers = vi.fn(async (servers: AiMcpServer[]) => servers);
  const listMediaModels = vi.fn(async () => ['qwen3.8-flash', 'qwen-image-3.0-pro', 'wan3.0-video', 'glm-5.3']);
  const testMediaGenerate = vi.fn(async () => 'C:/data/media-test/test-image.png');
  const openMediaTestDirectory = vi.fn(async () => {});
  const onSearchSaved = vi.fn();
  const onMediaSaved = vi.fn();
  const onMcpSaved = vi.fn();
  const backend = {
    load: vi.fn(), save: vi.fn(), saveProvider: vi.fn(), removeProvider: vi.fn(),
    listModels: vi.fn(), listTools: vi.fn(), decideTool: vi.fn(),
    saveSearchService, testSearchService, saveMediaService, saveMcpServers,
    listMediaModels, testMediaGenerate, openMediaTestDirectory,
    testConnection: vi.fn(), generate: vi.fn(), cancel: vi.fn(),
    openDataDirectory: vi.fn(), reset: vi.fn(),
  } as unknown as AiBackend;
  render(<AiSettings providers={[]} searchService={searchService} backend={backend}
    onSave={vi.fn()} onSearchSaved={onSearchSaved} onMediaSaved={onMediaSaved} onMcpSaved={onMcpSaved} onRemove={vi.fn()}
    onClearHistory={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
  return { saveSearchService, testSearchService, onSearchSaved, saveMediaService, saveMcpServers, onMediaSaved, onMcpSaved, listMediaModels, testMediaGenerate, openMediaTestDirectory };
}

function openSearchTab() {
  fireEvent.click(screen.getByRole('button', { name: 'Search service' }));
}

beforeEach(async () => { await i18n.changeLanguage('en'); });
afterEach(cleanup);

describe('AI search service settings', () => {
  it('sits alongside model services and archive as a peer section', () => {
    setup();
    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(nav.querySelectorAll('button')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Model services' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search service' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Media service' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'MCP servers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy();
  });

  it('saves a trimmed media endpoint and reports it back to the workspace', async () => {
    const { saveMediaService, onMediaSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Media service' }));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://media.test/v1/' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'media-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(saveMediaService).toHaveBeenCalled());
    expect(saveMediaService.mock.calls[0][0]).toMatchObject({ baseUrl: 'https://media.test/v1' });
    expect(saveMediaService.mock.calls[0][1]).toBe('media-key');
    await waitFor(() => expect(onMediaSaved).toHaveBeenCalled());
  });

  it('configures the Qianwen DashScope protocol with three model slots', async () => {
    const { saveMediaService } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Media service' }));
    expect(screen.queryByLabelText('Image-to-video model (optional)')).toBeNull();
    fireEvent.click(screen.getByRole('combobox', { name: 'Protocol' }));
    fireEvent.click(screen.getByRole('option', { name: 'Qianwen platform (DashScope)' }));
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://maas.qianwenaiapi.com/compatible-mode/v1');
    fireEvent.change(screen.getByLabelText('Text-to-image model (optional)'), { target: { value: 'qwen-image-3.0-pro' } });
    fireEvent.change(screen.getByLabelText('Text-to-video model (optional)'), { target: { value: 'wan3.0-video' } });
    fireEvent.change(screen.getByLabelText('Image-to-video model (optional)'), { target: { value: 'wan2.7-i2v' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save service' }));
    await waitFor(() => expect(saveMediaService).toHaveBeenCalled());
    expect(saveMediaService.mock.calls[0][0]).toMatchObject({
      protocol: 'dashscope',
      baseUrl: 'https://maas.qianwenaiapi.com/compatible-mode/v1',
      imageModel: 'qwen-image-3.0-pro',
      videoModel: 'wan3.0-video',
      imageToVideoModel: 'wan2.7-i2v',
    });
  });

  it('probes the media connection for free after saving, without generating anything', async () => {
    const { saveMediaService, listMediaModels, testMediaGenerate } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Media service' }));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://media.test/compatible-mode/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(listMediaModels).toHaveBeenCalled());
    expect(saveMediaService.mock.invocationCallOrder[0]).toBeLessThan(listMediaModels.mock.invocationCallOrder[0]);
    expect(testMediaGenerate).not.toHaveBeenCalled();
    expect(await screen.findByText('Connected. Found 4 models, 2 of them media models.')).toBeInTheDocument();
  });

  it('offers only media models in the pickers while still allowing a typed id', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Media service' }));
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://media.test/compatible-mode/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fetch models' }));
    const picker = await screen.findByRole('combobox', { name: 'Text-to-image model (optional)' });
    fireEvent.click(picker);
    const offered = screen.getAllByRole('option').map(item => item.getAttribute('aria-label'));
    expect(offered).toEqual(['Blank (use default model)', 'qwen-image-3.0-pro', 'wan3.0-video', 'Type manually…']);
    fireEvent.click(screen.getByRole('option', { name: 'qwen-image-3.0-pro' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Text-to-image model (optional)' })).toHaveTextContent('qwen-image-3.0-pro'));
    fireEvent.click(screen.getByRole('combobox', { name: 'Text-to-image model (optional)' }));
    fireEvent.click(screen.getByRole('option', { name: 'Type manually…' }));
    const typed = screen.getByLabelText('Text-to-image model (optional)');
    fireEvent.change(typed, { target: { value: 'a-model-the-filter-missed' } });
    expect(typed).toHaveValue('a-model-the-filter-missed');
  });

  it('previews the generated test image after saving the configuration', async () => {
    const createObjectURL = vi.fn(() => 'blob:media-preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['image']) })));
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    try {
      const { saveMediaService, testMediaGenerate } = setup();
      fireEvent.click(screen.getByRole('button', { name: 'Media service' }));
      fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://media.test/compatible-mode/v1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Generate test image' }));
      await waitFor(() => expect(testMediaGenerate).toHaveBeenCalledWith('image'));
      expect(saveMediaService.mock.invocationCallOrder[0]).toBeLessThan(testMediaGenerate.mock.invocationCallOrder[0]);
      const image = await screen.findByAltText('Test generated image');
      expect(image).toHaveAttribute('src', 'blob:media-preview');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('adds and saves an MCP server with command and arguments', async () => {
    const { saveMcpServers, onMcpSaved } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'MCP servers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add MCP server' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'filesystem' } });
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } });
    fireEvent.change(screen.getByLabelText('Arguments (space separated)'), { target: { value: '-y @modelcontextprotocol/server-filesystem C:/data' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save MCP servers' }));
    await waitFor(() => expect(saveMcpServers).toHaveBeenCalled());
    expect(saveMcpServers.mock.calls[0][0]).toHaveLength(1);
    expect(saveMcpServers.mock.calls[0][0][0]).toMatchObject({
      name: 'filesystem', command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:/data'], enabled: true,
    });
    await waitFor(() => expect(onMcpSaved).toHaveBeenCalled());
  });

  it('saves a trimmed endpoint and reports it back to the workspace', async () => {
    const { saveSearchService, onSearchSaved } = setup();
    openSearchTab();
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://example.test/v1/' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'search-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save search service' }));
    await waitFor(() => expect(saveSearchService).toHaveBeenCalled());
    expect(saveSearchService.mock.calls[0][0]).toMatchObject({ baseUrl: 'https://example.test/v1', enabled: true });
    expect(saveSearchService.mock.calls[0][1]).toBe('search-key');
    await waitFor(() => expect(onSearchSaved).toHaveBeenCalled());
  });

  it('tests the connection only after saving, and sends no conversation content', async () => {
    const { saveSearchService, testSearchService } = setup();
    openSearchTab();
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://example.test/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(testSearchService).toHaveBeenCalled());
    expect(saveSearchService).toHaveBeenCalled();
    expect(saveSearchService.mock.invocationCallOrder[0]).toBeLessThan(testSearchService.mock.invocationCallOrder[0]);
    expect(testSearchService.mock.calls[0]).toHaveLength(0);
  });

  it('refuses endpoints carrying credentials, query or fragment', async () => {
    const { saveSearchService } = setup();
    openSearchTab();
    for (const value of ['https://user:pass@example.test/v1', 'https://example.test/v1?x=1', 'https://example.test/v1#f']) {
      fireEvent.change(screen.getByLabelText('Base URL'), { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Save search service' }));
      await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    }
    expect(saveSearchService).not.toHaveBeenCalled();
  });

  it('loads an existing configuration and keeps the saved key unless replaced', async () => {
    const { saveSearchService } = setup({ baseUrl: 'https://example.test/v1', hasApiKey: true, enabled: false });
    openSearchTab();
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://example.test/v1');
    expect(screen.getByRole('checkbox', { name: 'Enable service' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save search service' }));
    await waitFor(() => expect(saveSearchService).toHaveBeenCalled());
    expect(saveSearchService.mock.calls[0][1]).toBeUndefined();
  });
});