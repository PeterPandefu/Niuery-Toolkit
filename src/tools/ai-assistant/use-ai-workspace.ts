import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { nanoid } from 'nanoid';
import { createWorkspace, providerTarget } from './model';
import { requestMessages } from './request-messages';
import { useToolCalls, settlePendingCalls } from './use-tool-calls';
import { buildBudgetedContext } from './context';
import { retainAnswerVersion } from './branches';
import { validateAttachments } from './attachments';
import { aiUpdatePending, subscribeAiUpdate } from './update-lock';
import type { AiAttachment, AiBackend, AiConversation, AiMessage, AiProvider, AiRequest, AiStreamEvent, AiTaskPlan, AiWorkspace } from './types';

type Busy = Pick<AiRequest, 'requestId' | 'conversationId' | 'messageId'>;
type ActiveRequest = Busy & { previous?: AiMessage; terminated: boolean; startedAt: number; taskId?: string };
type Updater = (workspace: AiWorkspace) => AiWorkspace;
export interface AiSendOptions { editMessageId?: string; content?: string; attachments?: AiAttachment[]; expectedTarget?: string }
export type AiSendOutcome = { type: 'not-sent'; reason: string } | { type: 'settled'; requestId: string };
const describeError = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function useAiWorkspace(backend: AiBackend) {
  const updatePending = useSyncExternalStore(subscribeAiUpdate, aiUpdatePending, aiUpdatePending);
  const [workspace, setWorkspace] = useState<AiWorkspace>(createWorkspace);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy[]>([]);
  const valueRef = useRef(workspace);
  const mounted = useRef(false);
  const initialized = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const active = useRef<Map<string, ActiveRequest>>(new Map());
  const batch = useRef<Map<string, { cancelled: boolean }>>(new Map());
  const cancelling = useRef<Map<string, Busy>>(new Map());
  const cancelPending = useRef<Map<string, Promise<void>>>(new Map());
  const mutationsPending = useRef(0);
  const exiting = useRef(0);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGeneration = useRef(0);

  const replace = useCallback((next: AiWorkspace) => {
    valueRef.current = next;
    if (mounted.current) setWorkspace(next);
  }, []);

  const activeIn = useCallback((conversationId: string) => {
    for (const request of active.current.values()) if (request.conversationId === conversationId) return request;
    return undefined;
  }, []);

  const busyIn = useCallback((conversationId: string) => {
    if (activeIn(conversationId) || batch.current.has(conversationId)) return true;
    for (const request of cancelling.current.values()) if (request.conversationId === conversationId) return true;
    return false;
  }, [activeIn]);

  const generating = useCallback(() => active.current.size > 0 || cancelling.current.size > 0 || batch.current.size > 0, []);

  const addBusy = useCallback((entry: Busy) => {
    setBusy(list => [...list.filter(item => item.requestId !== entry.requestId), entry]);
  }, []);

  const removeBusy = useCallback((requestId: string) => {
    setBusy(list => list.filter(item => item.requestId !== requestId));
  }, []);

  /** All disk/credential mutations share this queue, preserving write order. */
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const pending = queue.current.then(operation);
    queue.current = pending.then(() => {}, () => {});
    return pending;
  }, []);

  const persist = useCallback((snapshot = valueRef.current): Promise<void> => {
    if (!initialized.current) return Promise.reject(new Error('AI 数据尚未成功加载，不能保存。'));
    // A regeneration only replaces its durable answer after success. If the
    // process crashes mid-stream, reopening still restores the previous reply.
    let durable = snapshot;
    for (const pending of active.current.values()) {
      if (!pending.previous || pending.terminated) continue;
      const previous = pending.previous;
      durable = { ...durable, conversations: durable.conversations.map(chat => chat.id === pending.conversationId ? { ...chat,
        messages: chat.messages.map(message => message.id === pending.messageId ? previous : message),
      } : chat) };
    }
    return enqueue(async () => {
      try {
        // Provider operations can complete while a draft snapshot is queued.
        // Take provider metadata at execution time to avoid restoring removed
        // credentials/configuration from an older conversation snapshot.
        await backend.save({ ...durable, providers: valueRef.current.providers });
        if (mounted.current) setSaveError(null);
      } catch (reason) {
        if (mounted.current) setSaveError(describeError(reason));
        throw reason;
      }
    });
  }, [backend, enqueue]);

  const saveQuietly = useCallback(() => { void persist().catch(() => {}); }, [persist]);

  const update = useCallback((updater: Updater) => {
    if (!initialized.current || exiting.current || aiUpdatePending()) return;
    replace(updater(valueRef.current));
    saveQuietly();
  }, [replace, saveQuietly]);

  const changeConversation = useCallback((id: string, updater: (conversation: AiConversation) => AiConversation) => {
    replace({ ...valueRef.current, conversations: valueRef.current.conversations.map(chat => chat.id === id ? updater(chat) : chat) });
  }, [replace]);

  const toolCalls = useToolCalls({ changeConversation, saveQuietly, backend });
  const { handleEvent: handleToolEvent, clear: clearToolApproval } = toolCalls;

  const changeReply = useCallback((request: ActiveRequest, updater: (message: AiMessage) => AiMessage) => {
    changeConversation(request.conversationId, chat => ({ ...chat, updatedAt: Date.now(),
      ...(request.taskId ? { tasks: chat.tasks?.map(task => task.id === request.taskId ? { ...task, results: task.results.map(result => result.message.id === request.messageId ? { ...result, message: updater(result.message) } : result) } : task) }
        : { messages: chat.messages.map(message => message.id === request.messageId ? updater(message) : message) }) }));
  }, [changeConversation]);

  const interruptTasks = useCallback(() => {
    if (!batch.current.size) return;
    for (const running of batch.current.values()) running.cancelled = true;
    replace({ ...valueRef.current, conversations: valueRef.current.conversations.map(chat => ({ ...chat, tasks: chat.tasks?.map(task => ({ ...task,
      results: task.results.map(result => result.message.status === 'waiting' || result.message.status === 'streaming' ? { ...result, message: { ...result.message, status: 'interrupted' } } : result) })) })) });
  }, [replace]);

  const clearProgressTimer = useCallback(() => {
    if (progressTimer.current !== null) clearTimeout(progressTimer.current);
    progressTimer.current = null;
  }, []);

  const finish = useCallback(async (request: ActiveRequest, status: AiMessage['status'], reason?: string) => {
    if (request.terminated || active.current.get(request.requestId) !== request) return;
    request.terminated = true;
    clearProgressTimer();
    changeReply(request, message => {
      if (status !== 'complete' && request.previous) return request.previous;
      const completed = { ...message, toolCalls: settlePendingCalls(message.toolCalls, '生成已结束，此调用未执行。'), status, error: reason, durationMs: Math.max(0, Date.now() - request.startedAt) };
      return status === 'complete' && request.previous ? retainAnswerVersion(request.previous, completed) : completed;
    });
    active.current.delete(request.requestId);
    if (mounted.current) {
      if (!cancelling.current.has(request.requestId)) removeBusy(request.requestId);
      if (reason) setError(reason);
    }
    await persist();
  }, [changeReply, clearProgressTimer, persist, removeBusy]);

  const reload = useCallback(async () => {
    if (generating()) { setError('请先停止当前生成，再重新加载数据。'); return; }
    const generation = ++loadGeneration.current;
    initialized.current = false;
    if (mounted.current) { setLoading(true); setError(null); }
    try {
      await queue.current;
      const saved = await backend.load();
      if (!mounted.current || generation !== loadGeneration.current) return;
      if (saved && saved.version !== 1) throw new Error('不支持此 AI 数据版本，请保留数据并升级应用。');
      const next = saved ?? createWorkspace();
      if (!Array.isArray(next.assistants) || !next.assistants.length || !Array.isArray(next.conversations) || !Array.isArray(next.providers)) {
        throw new Error('AI 数据结构损坏，请打开数据目录检查备份。');
      }
      // Establish complete default metadata before provider/credential commands
      // can operate, so a first-run interruption never leaves providers alone.
      if (!saved) await enqueue(() => backend.save(next));
      if (!mounted.current || generation !== loadGeneration.current) return;
      const recovered: AiWorkspace = { ...next, conversations: next.conversations.map(chat => ({ ...chat,
        messages: chat.messages.map(message => message.status === 'waiting' || message.status === 'streaming' ? { ...message, status: 'interrupted', toolCalls: settlePendingCalls(message.toolCalls, '回复意外中断，此调用未执行。') } : message),
        tasks: chat.tasks?.map(task => ({ ...task, results: task.results.map(result => ({ ...result, message: result.message.status === 'waiting' || result.message.status === 'streaming' ? { ...result.message, status: 'interrupted', toolCalls: settlePendingCalls(result.message.toolCalls, '回复意外中断，此调用未执行。') } : result.message })) })),
      })) };
      initialized.current = true;
      replace(recovered);
      setSaveError(null);
    } catch (reason) {
      if (mounted.current && generation === loadGeneration.current) setError(describeError(reason));
    } finally {
      if (mounted.current && generation === loadGeneration.current) setLoading(false);
    }
  }, [backend, enqueue, replace, generating]);

  useEffect(() => {
    mounted.current = true;
    const activeRequests = active.current;
    void reload();
    return () => {
      mounted.current = false;
      interruptTasks();
      clearProgressTimer();
      for (const request of [...activeRequests.values()]) {
        // finish mutates the ref even after unmount, then queues its final snapshot.
        void finish(request, 'interrupted').catch(() => {});
        void backend.cancel(request.requestId).catch(() => {});
      }
    };
  }, [backend, clearProgressTimer, finish, reload, interruptTasks]);

  useEffect(() => {
    if (!backend.onExitRequested) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void backend.onExitRequested(async hold => {
      exiting.current++;
      interruptTasks();
      let retained = false;
      try {
        const requests = [...active.current.values()];
        if (requests.length) {
          const results = await Promise.allSettled(requests.flatMap(request => [
            finish(request, 'interrupted'), backend.cancel(request.requestId),
          ]));
          for (const result of results) if (result.status === 'rejected') throw result.reason;
        }
        await queue.current;
        if (initialized.current) await persist();
        if (hold) {
          retained = true;
          let released = false;
          return () => { if (!released) { released = true; exiting.current--; } };
        }
      } catch (reason) {
        if (mounted.current) setError(describeError(reason));
        throw reason;
      } finally { if (!retained) exiting.current--; }
    }).then(dispose => { if (disposed) void queue.current.then(dispose); else unlisten = dispose; })
      .catch(reason => { if (mounted.current) setError(describeError(reason)); });
    return () => { disposed = true; if (unlisten) void queue.current.then(unlisten); };
  }, [backend, finish, persist, interruptTasks]);

  const run = useCallback(async (conversationId: string, options: AiSendOptions = {}, regenerate = false): Promise<AiSendOutcome> => {
    if (exiting.current || aiUpdatePending()) return { type: 'not-sent', reason: '应用正在保存退出或更新' };
    if (!initialized.current) { setError('AI 数据尚未加载，请先恢复数据。'); return { type: 'not-sent', reason: 'AI 数据尚未加载' }; }
    if (busyIn(conversationId)) { setError('该会话正在生成，请先停止后再发送。'); return { type: 'not-sent', reason: '已有生成任务' }; }
    if (mutationsPending.current) { setError('正在保存或修改 AI 配置，请完成后再发送消息。'); return { type: 'not-sent', reason: '配置正在保存' }; }
    setError(null);
    let request: ActiveRequest | undefined;
    let unsavedDraft: Pick<AiConversation, 'draft' | 'draftAttachments'> | undefined;
    let networkStarted = false;
    try {
      const current = valueRef.current;
      const chat = current.conversations.find(item => item.id === conversationId);
      if (!chat) throw new Error('会话不存在，请重新选择会话。');
      const provider = current.providers.find(item => item.id === chat.providerId && item.enabled);
      const model = provider?.models.find(item => item.id === chat.modelId);
      if (!provider || !model) throw new Error('请先配置并选择可用的模型服务。');
      const target = providerTarget(provider);
      if (options.expectedTarget && options.expectedTarget !== target) throw new Error('目标服务已更改，请重新确认发送。');
      if (chat.approvedTargets.length > 0 && !chat.approvedTargets.includes(target)) throw new Error('目标服务已更改，请先确认将消息和历史发送到此服务。');

      let messages = chat.messages;
      let previous: AiMessage | undefined;
      if (regenerate) {
        const answerIndex = messages.length - 1;
        const answer = messages[answerIndex];
        if (!answer || answer.role !== 'assistant' || messages[answerIndex - 1]?.role !== 'user') throw new Error('没有可重新生成的最后一条回复。');
        previous = answer;
        messages = messages.slice(0, answerIndex);
      } else if (options.editMessageId) {
        const editIndex = messages.findIndex(message => message.id === options.editMessageId && message.role === 'user');
        if (editIndex < 0) throw new Error('要编辑的用户消息不存在。');
        const original = messages[editIndex];
        const content = options.content ?? original.content;
        if (!content.trim() && !original.attachments.length) throw new Error('请输入消息或添加附件。');
        messages = [...messages.slice(0, editIndex), { ...original, content, status: 'complete' as const }];
      } else {
        const content = options.content ?? chat.draft;
        const attachments = options.attachments ?? chat.draftAttachments;
        if (!content.trim() && !attachments.length) throw new Error('请输入消息或添加附件。');
        validateAttachments(attachments);
        messages = [...messages, { id: nanoid(), role: 'user', content, attachments: [...attachments], createdAt: Date.now(), status: 'complete' }];
      }
      const budget = buildBudgetedContext({ ...chat, messages }, model);
      const context = budget.messages;
      for (const message of context) validateAttachments(message.attachments);
      if (!model.supportsImages && context.some(message => message.attachments.some(file => file.kind === 'image'))) {
        throw new Error('当前上下文含图片，请选择支持图片的模型，或使用不含图片的新会话／上下文。');
      }
      request = { requestId: nanoid(), conversationId, messageId: previous?.id ?? nanoid(), previous, terminated: false, startedAt: Date.now() };
      const reply: AiMessage = { id: request.messageId, role: 'assistant', content: '', attachments: [], createdAt: Date.now(),
        status: 'waiting', providerId: provider.id, modelId: model.id };
      const firstQuestion = messages.find(message => message.role === 'user');
      const submittedAttachments = options.attachments ?? chat.draftAttachments;
      const clearDraft = !regenerate && !options.editMessageId
        && (options.content ?? chat.draft) === chat.draft
        && JSON.stringify(submittedAttachments) === JSON.stringify(chat.draftAttachments);
      const nextChat: AiConversation = { ...chat, messages: [...messages, reply],
        draft: clearDraft ? '' : chat.draft,
        draftAttachments: clearDraft ? [] : chat.draftAttachments,
        title: chat.title === '新会话' && firstQuestion ? (firstQuestion.content.trim().slice(0, 40) || firstQuestion.attachments[0]?.name || '新会话') : chat.title,
        approvedTargets: chat.approvedTargets.includes(target) ? chat.approvedTargets : [...chat.approvedTargets, target], updatedAt: Date.now() };
      if (clearDraft) unsavedDraft = { draft: chat.draft, draftAttachments: chat.draftAttachments };
      changeConversation(conversationId, () => nextChat);
      active.current.set(request.requestId, request);
      addBusy({ requestId: request.requestId, conversationId, messageId: request.messageId });
      // Never start the network until input and attachment copies have reached disk.
      await persist();
      if (active.current.get(request.requestId) !== request || request.terminated || !mounted.current) return { type: 'settled', requestId: request.requestId };
      const running = request;
      const onEvent = (event: AiStreamEvent) => {
        if (active.current.get(running.requestId) !== running || running.terminated || event.requestId !== running.requestId
          || event.conversationId !== running.conversationId || event.messageId !== running.messageId) return;
        if (event.type === 'thinking') {
          changeConversation(conversationId, value => ({ ...value, updatedAt: Date.now(), messages: value.messages.map(message => message.id === running.messageId ? { ...message, thinking: `${message.thinking ?? ''}${event.text ?? ''}`, status: 'streaming' } : message) }));
          if (progressTimer.current === null) progressTimer.current = setTimeout(() => { progressTimer.current = null; saveQuietly(); }, 500);
        } else if (event.type === 'delta') {
          changeConversation(conversationId, value => ({ ...value, updatedAt: Date.now(), messages: value.messages.map(message => message.id === running.messageId
            ? { ...message, content: message.content + (event.text ?? ''), status: 'streaming', firstTokenMs: message.firstTokenMs ?? Math.max(0, Date.now() - running.startedAt) } : message) }));
          if (progressTimer.current === null) progressTimer.current = setTimeout(() => {
            progressTimer.current = null;
            saveQuietly();
          }, 500);
        } else if (event.type === 'metadata') {
          changeConversation(conversationId, value => ({ ...value, messages: value.messages.map(message => message.id === running.messageId ? { ...message, finishReason: event.finishReason ?? message.finishReason, usage: event.usage ?? message.usage } : message) }));
        } else if (event.type === 'round_reset') {
          changeConversation(conversationId, value => ({ ...value, updatedAt: Date.now(), messages: value.messages.map(message => message.id === running.messageId ? { ...message, content: '', thinking: undefined, status: 'streaming' } : message) }));
        } else if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'approval_required' || event.type === 'question_required') {
          handleToolEvent(event, conversationId, running.messageId);
        } else {
          clearToolApproval(conversationId);
          const status = event.type === 'done' ? 'complete' : event.type === 'stopped' ? 'stopped' : 'failed';
          void finish(running, status, event.error || (event.type === 'error' ? '生成失败，请检查模型服务后重试。' : undefined)).catch(() => {});
        }
      };
      networkStarted = true;
      await backend.generate({ requestId: running.requestId, conversationId, messageId: running.messageId,
        providerId: provider.id, modelId: model.id, systemPrompt: budget.systemPrompt, parameters: budget.parameters,
        permissionMode: chat.permissionMode ?? 'ask',
        messages: requestMessages(context) }, onEvent);
      if (active.current.get(running.requestId) === running && !running.terminated) await finish(running, 'interrupted', '回复流意外结束，请重试。');
    } catch (reason) {
      const text = describeError(reason);
      if (request && active.current.get(request.requestId) === request && !request.terminated) {
        if (!networkStarted && unsavedDraft) {
          const originalDraft = unsavedDraft;
          changeConversation(conversationId, value => !value.draft && !value.draftAttachments.length ? { ...value, ...originalDraft } : value);
        }
        await finish(request, 'failed', text).catch(() => {});
      } else if (!request || !request.terminated) {
        if (mounted.current) setError(text);
      }
    }
    return request ? { type: 'settled', requestId: request.requestId } : { type: 'not-sent', reason: '请求未发送' };
  }, [backend, changeConversation, finish, persist, saveQuietly, handleToolEvent, clearToolApproval, busyIn, addBusy]);

  const send = useCallback((id: string, options?: AiSendOptions) => run(id, options), [run]);
  const regenerate = useCallback((id: string, options: AiSendOptions = {}) => run(id, options, true), [run]);

  const runTask = useCallback(async (conversationId: string, plan: AiTaskPlan) => {
    if (!initialized.current || exiting.current || aiUpdatePending() || busyIn(conversationId) || mutationsPending.current) throw new Error('请先完成当前操作，再运行任务。');
    const chat = valueRef.current.conversations.find(chat => chat.id === conversationId);
    if (!chat || !plan.requests.length || plan.requests.some(request => request.conversationId !== conversationId)) throw new Error('任务会话无效');
    for (const request of plan.requests) {
      const provider = valueRef.current.providers.find(provider => provider.id === request.providerId && provider.enabled);
      if (!provider || !provider.models.some(model => model.id === request.modelId) || !plan.targets.includes(providerTarget(provider))) throw new Error('任务目标已更改，请重新创建任务');
    }
    const runningBatch = { cancelled: false }; batch.current.set(conversationId, runningBatch);
    addBusy({ requestId: plan.requests[0].requestId, conversationId, messageId: plan.requests[0].messageId });
    setError(null);
    changeConversation(conversationId, chat => ({ ...chat, tasks: [...(chat.tasks ?? []), { id: plan.id, kind: plan.kind, createdAt: plan.createdAt, prompt: plan.prompt, results: plan.results }], approvedTargets: [...new Set([...chat.approvedTargets, ...plan.targets])] }));
    try {
      await persist();
      for (const request of plan.requests) {
        if (runningBatch.cancelled || !mounted.current || exiting.current || aiUpdatePending()) break;
        const running: ActiveRequest = { requestId: request.requestId, conversationId, messageId: request.messageId, startedAt: Date.now(), terminated: false, taskId: plan.id };
        active.current.set(running.requestId, running); addBusy({ requestId: running.requestId, conversationId, messageId: running.messageId });
        try {
          await backend.generate({ ...request, messages: requestMessages(request.messages) }, event => {
            if (active.current.get(running.requestId) !== running || running.terminated || event.requestId !== running.requestId || event.conversationId !== conversationId || event.messageId !== running.messageId) return;
            if (event.type === 'thinking') {
              changeReply(running, message => ({ ...message, thinking: `${message.thinking ?? ''}${event.text ?? ''}`, status: 'streaming' }));
              if (progressTimer.current === null) progressTimer.current = setTimeout(() => { progressTimer.current = null; saveQuietly(); }, 500);
            } else if (event.type === 'delta') {
              changeReply(running, message => ({ ...message, content: message.content + (event.text ?? ''), status: 'streaming', firstTokenMs: message.firstTokenMs ?? Math.max(0, Date.now() - running.startedAt) }));
              if (progressTimer.current === null) progressTimer.current = setTimeout(() => { progressTimer.current = null; saveQuietly(); }, 500);
            } else if (event.type === 'metadata') {
              changeReply(running, message => ({ ...message, finishReason: event.finishReason ?? message.finishReason, usage: event.usage ?? message.usage }));
            } else if (event.type === 'round_reset') {
              changeReply(running, message => ({ ...message, content: '', thinking: undefined, status: 'streaming' }));
            } else if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'approval_required' || event.type === 'question_required') {
              handleToolEvent(event, conversationId, running.messageId);
            } else {
              clearToolApproval(conversationId);
              void finish(running, event.type === 'done' ? 'complete' : event.type === 'stopped' ? 'stopped' : 'failed', event.error).catch(() => {});
            }
          });
          if (active.current.get(running.requestId) === running && !running.terminated) await finish(running, 'interrupted', '任务回复流意外结束');
        } catch (reason) { if (active.current.get(running.requestId) === running && !running.terminated) await finish(running, 'failed', describeError(reason)); }
        await persist();
      }
    } catch (reason) { runningBatch.cancelled = true; if (mounted.current) setError(describeError(reason)); }
    finally {
      changeConversation(conversationId, chat => ({ ...chat, tasks: chat.tasks?.map(task => task.id === plan.id ? { ...task, results: task.results.map(result => result.message.status === 'waiting' ? { ...result, message: { ...result.message, status: 'stopped' } } : result) } : task) }));
      if (batch.current.get(conversationId) === runningBatch) batch.current.delete(conversationId);
      if (mounted.current) setBusy(list => list.filter(item => item.conversationId !== conversationId || cancelling.current.has(item.requestId)));
      await persist().catch(() => {});
    }
  }, [backend, changeConversation, changeReply, finish, persist, saveQuietly, handleToolEvent, clearToolApproval, busyIn, addBusy]);

  const stop = useCallback((conversationId?: string): Promise<void> => {
    const batchIds = conversationId ? (batch.current.has(conversationId) ? [conversationId] : []) : [...batch.current.keys()];
    if (batchIds.length) {
      for (const id of batchIds) batch.current.get(id)!.cancelled = true;
      replace({ ...valueRef.current, conversations: valueRef.current.conversations.map(chat => batchIds.includes(chat.id) ? { ...chat, tasks: chat.tasks?.map(task => ({ ...task, results: task.results.map(result => result.message.status === 'waiting' ? { ...result, message: { ...result.message, status: 'stopped' } } : result) })) } : chat) });
    }
    const targets = [...active.current.values()].filter(request => !conversationId || request.conversationId === conversationId);
    if (!targets.length) return persist().catch(() => {});
    const pendings: Promise<void>[] = [];
    for (const request of targets) {
      const existing = cancelPending.current.get(request.conversationId);
      if (existing) { pendings.push(existing); continue; }
      cancelling.current.set(request.requestId, request);
      clearToolApproval(request.conversationId);
      const saved = finish(request, 'stopped').catch(() => {});
      const pending = (async () => {
        try { await backend.cancel(request.requestId); }
        catch (reason) { if (mounted.current) setError(describeError(reason)); }
        finally {
          cancelling.current.delete(request.requestId);
          cancelPending.current.delete(request.conversationId);
          if (mounted.current) removeBusy(request.requestId);
        }
        await saved;
      })();
      cancelPending.current.set(request.conversationId, pending);
      pendings.push(pending);
    }
    return Promise.all(pendings).then(() => {});
  }, [backend, finish, replace, persist, removeBusy, clearToolApproval]);

  const saveProvider = useCallback(async (provider: AiProvider, apiKey?: string) => {
    if (exiting.current || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    if (!initialized.current) throw new Error('AI 数据尚未加载，不能修改服务。');
    if (generating()) throw new Error('请先停止生成，再修改模型服务。');
    mutationsPending.current++;
    try {
      await enqueue(async () => {
        const saved = await backend.saveProvider(provider, apiKey);
        const providers = valueRef.current.providers.filter(item => item.id !== saved.id);
        replace({ ...valueRef.current, providers: [...providers, saved] });
      });
      await persist();
    } catch (reason) { if (mounted.current) setError(describeError(reason)); throw reason; }
    finally { mutationsPending.current--; }
  }, [backend, enqueue, persist, replace, generating]);

  const removeProvider = useCallback(async (id: string) => {
    if (exiting.current || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    if (!initialized.current) throw new Error('AI 数据尚未加载，不能删除服务。');
    if (generating()) throw new Error('请先停止生成，再删除模型服务。');
    mutationsPending.current++;
    try {
      await enqueue(async () => {
        await backend.removeProvider(id);
        replace({ ...valueRef.current, providers: valueRef.current.providers.filter(provider => provider.id !== id) });
      });
      await persist();
    } catch (reason) { if (mounted.current) setError(describeError(reason)); throw reason; }
    finally { mutationsPending.current--; }
  }, [backend, enqueue, persist, replace, generating]);

  const clearHistory = useCallback(async () => {
    if (exiting.current || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    if (!initialized.current) throw new Error('AI 数据尚未加载，不能清空历史。');
    mutationsPending.current++;
    try {
      if (generating()) await stop();
      replace({ ...valueRef.current, conversations: [], activeConversationId: undefined });
      await persist();
    } finally { mutationsPending.current--; }
  }, [persist, replace, stop, generating]);

  const reset = useCallback(async () => {
    if (exiting.current || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    mutationsPending.current++;
    try {
      if (generating()) await stop();
      if (mounted.current) setLoading(true);
      initialized.current = false;
      await enqueue(async () => {
        await backend.reset();
        const next = createWorkspace();
        replace(next);
        await backend.save(next);
      });
      initialized.current = true;
      if (mounted.current) { setError(null); setSaveError(null); setLoading(false); }
    } catch (reason) {
      if (mounted.current) { setLoading(false); setError(describeError(reason)); setSaveError(describeError(reason)); }
      throw reason;
    } finally { mutationsPending.current--; }
  }, [backend, enqueue, replace, stop, generating]);

  return { workspace, loading: loading || updatePending, updating: updatePending, error, saveError, busy, update, reload, send, regenerate, runTask, stop, saveProvider, removeProvider, clearHistory, reset, toolCalls };
}