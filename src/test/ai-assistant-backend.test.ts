import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiProvider, AiRequest, AiStreamEvent } from '@/tools/ai-assistant/types';

const transport = vi.hoisted(() => ({ invoke: vi.fn(), channel: null as { onmessage: (event: unknown) => void } | null }));
const events = vi.hoisted(() => ({ listen: vi.fn(), unlisten: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: events.listen }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: transport.invoke,
  Channel: class {
    onmessage = (_event: unknown) => {};
    constructor() { transport.channel = this; }
  },
}));

import { desktopAiBackend, prepareAiForUpdate } from '@/tools/ai-assistant/backend';

const provider: AiProvider = { id: 'service', name: 'Local', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434', models: [], enabled: true, hasApiKey: false };
const request: AiRequest = {
  requestId: 'request1', conversationId: 'conversation1', messageId: 'message1', providerId: 'service', modelId: 'example',
  systemPrompt: 'Helpful', parameters: { historyRounds: 20 }, messages: [],
};

describe('AI desktop bridge', () => {
  beforeEach(() => {
    transport.invoke.mockReset();
    events.listen.mockReset();
    events.unlisten.mockReset();
    events.listen.mockResolvedValue(events.unlisten);
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  });

  it('keeps credential replacement separate from ordinary provider metadata', async () => {
    transport.invoke.mockResolvedValue({ ...provider, hasApiKey: true });
    const saved = await desktopAiBackend.saveProvider(provider, 'test-only-key');
    expect(saved.hasApiKey).toBe(true);
    expect(transport.invoke).toHaveBeenCalledWith('ai_save_provider', { provider, apiKey: 'test-only-key' });
    transport.invoke.mockClear();
    await desktopAiBackend.saveProvider(saved);
    expect(transport.invoke).toHaveBeenCalledWith('ai_save_provider', { provider: saved });
  });

  it('passes streaming events to the matching request only', async () => {
    const received: AiStreamEvent[] = [];
    transport.invoke.mockImplementation(async (command: string) => {
      if (command === 'ai_generate') {
        transport.channel!.onmessage({ ...request, requestId: 'different', type: 'delta', text: 'wrong' });
        transport.channel!.onmessage({ requestId: 'request1', conversationId: 'conversation1', messageId: 'message1', type: 'delta', text: '你好' });
        transport.channel!.onmessage({ requestId: 'request1', conversationId: 'conversation1', messageId: 'message1', type: 'done' });
      }
    });
    await desktopAiBackend.generate(request, event => received.push(event));
    expect(received.map(event => event.type)).toEqual(['delta', 'done']);
    expect(received[0].text).toBe('你好');
  });

  it('forwards cancellation to the backend instead of only discarding output', async () => {
    transport.invoke.mockResolvedValue(undefined);
    await desktopAiBackend.cancel('request1');
    expect(transport.invoke).toHaveBeenCalledWith('ai_cancel', { requestId: 'request1' });
  });

  it('allows native exit only after the final local save succeeds', async () => {
    transport.invoke.mockResolvedValue(undefined);
    const flush = vi.fn(async () => {});
    const dispose = await desktopAiBackend.onExitRequested!(flush);
    expect(events.listen).toHaveBeenCalledWith('ai-prepare-exit', expect.any(Function));
    expect(transport.invoke).toHaveBeenCalledWith('ai_set_exit_listener', { ready: true });
    const handler = events.listen.mock.calls[0][1] as () => Promise<void>;
    await handler();
    expect(flush).toHaveBeenCalledOnce();
    expect(transport.invoke).toHaveBeenLastCalledWith('ai_complete_exit', { success: true });
    flush.mockRejectedValueOnce(new Error('disk full'));
    await handler();
    expect(transport.invoke).toHaveBeenLastCalledWith('ai_complete_exit', { success: false });
    dispose();
    expect(events.unlisten).toHaveBeenCalledOnce();
  });

  it('never saves a key through the browser development fallback', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    await expect(desktopAiBackend.saveProvider(provider, 'test-only-key')).rejects.toThrow(/桌面|desktop/i);
    expect(transport.invoke).not.toHaveBeenCalled();
    expect(localStorage.getItem('test-only-key')).toBeNull();
  });

  it('holds registered workspaces before update installation and propagates save errors', async () => {
    transport.invoke.mockResolvedValue(undefined);
    const unlock = vi.fn();
    const flush = vi.fn(async () => unlock);
    const dispose = await desktopAiBackend.onExitRequested!(flush);
    try {
      const release = await prepareAiForUpdate();
      expect(flush).toHaveBeenCalledWith(true);
      expect(unlock).not.toHaveBeenCalled();
      release(); release();
      expect(unlock).toHaveBeenCalledOnce();
      flush.mockRejectedValueOnce(new Error('disk full'));
      await expect(prepareAiForUpdate()).rejects.toThrow('disk full');
    } finally { dispose(); }
    flush.mockClear();
    (await prepareAiForUpdate())();
    expect(flush).not.toHaveBeenCalled();
  });
});
