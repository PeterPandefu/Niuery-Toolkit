import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import { mapAiMessage } from '@/tools/ai-assistant/runtime/message-mapper';
import i18n from '@/i18n';
import type { AiMessage } from '@/tools/ai-assistant/types';

afterEach(cleanup);
const message = (overrides: Partial<AiMessage> = {}): AiMessage => ({ id: 'a', role: 'assistant', content: 'Answer', thinking: 'Thought', attachments: [], createdAt: 1, status: 'complete', ...overrides });

describe('assistant-ui message bridge', () => {
  it('projects stable message IDs and separate thinking parts without writing to domain state', () => {
    const source = message(); const projected = mapAiMessage(source);
    expect(projected.id).toBe('a'); expect(projected.content).toEqual([{ type: 'reasoning', text: 'Thought' }, { type: 'text', text: 'Answer' }]);
    expect(projected.status).toEqual({ type: 'complete', reason: 'stop' });
    expect(source).toMatchObject({ thinking: 'Thought', status: 'complete' });
    expect(mapAiMessage(source, false).content).toEqual([{ type: 'text', text: 'Answer' }]);
  });
  it.each([
    ['waiting', undefined, { type: 'running' }], ['streaming', undefined, { type: 'running' }],
    ['stopped', undefined, { type: 'incomplete', reason: 'cancelled' }], ['interrupted', undefined, { type: 'incomplete', reason: 'other' }],
    ['failed', undefined, { type: 'incomplete', reason: 'error', error: 'Failure' }],
    ['complete', 'length', { type: 'incomplete', reason: 'length' }], ['complete', 'content_filter', { type: 'incomplete', reason: 'content-filter' }],
  ] as const)('maps %s and %s without changing the stored status', (status, finishReason, expected) => {
    expect(mapAiMessage(message({ status, finishReason, error: status === 'failed' ? 'Failure' : undefined })).status).toEqual(expected);
  });
  it('renders actual framework message parts and follows host updates', async () => {
    const onNew = vi.fn(async (_message: unknown) => {});
    function Harness({ value }: { value: AiMessage }) {
      const runtime = useExternalStoreRuntime({ messages: [value], convertMessage: (message: AiMessage) => mapAiMessage(message), onNew });
      return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root><ThreadPrimitive.Messages>{() => <MessagePrimitive.Root><MessagePrimitive.Parts /></MessagePrimitive.Root>}</ThreadPrimitive.Messages><button onClick={() => runtime.thread.append('Next')}>Send test</button></ThreadPrimitive.Root></AssistantRuntimeProvider>;
    }
    const { rerender } = render(<Harness value={message()} />);
    expect(screen.getByText('Answer')).toBeInTheDocument();
    rerender(<Harness value={message({ content: 'Updated' })} />);
    expect(await screen.findByText('Updated')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Send test')); await waitFor(() => expect(onNew).toHaveBeenCalledTimes(1));
    expect(onNew.mock.calls[0]?.[0]).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'Next' }] });
  });
});

it('pages long histories through the runtime and reveals search targets without changing stored messages', async () => {
  await i18n.changeLanguage('en');
  const { AiThread, LoadEarlierMessages } = await import('@/tools/ai-assistant/runtime/thread-view');
  const source = Array.from({ length: 201 }, (_, index) => message({ id: `row-${index}`, content: `History row ${index}`, thinking: undefined }));
  const actions = { append: vi.fn(async () => {}), reload: vi.fn(async () => {}), cancel: vi.fn(async () => {}) };
  function History({ target }: { target?: string }) {
    return <AiThread messages={source} providers={[]} actions={actions} running={false} disabled={false} sendDisabled={false} targetMessageId={target}><main>
      <LoadEarlierMessages /><ThreadPrimitive.Messages>{() => <MessagePrimitive.Root><MessagePrimitive.Parts /></MessagePrimitive.Root>}</ThreadPrimitive.Messages>
    </main></AiThread>;
  }
  const { rerender } = render(<History />);
  expect(screen.getByText('History row 200')).toBeInTheDocument();
  expect(screen.queryByText('History row 0')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Load earlier messages|显示较早的消息/ }));
  await screen.findByText('History row 1');
  expect(screen.queryByText('History row 0')).not.toBeInTheDocument();
  rerender(<History target="row-0" />);
  await screen.findByText('History row 0');
  expect(source).toHaveLength(201);
  expect(source[0].content).toBe('History row 0');
  expect(actions.append).not.toHaveBeenCalled();
});
