import { useEffect, useSyncExternalStore } from 'react';
import { nanoid } from 'nanoid';
import { createWorkspace, providerTarget } from './model';
import { requestMessages } from './request-messages';
import { createToolCallTracker, settlePendingCalls } from './use-tool-calls';
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

interface Snapshot {
  workspace: AiWorkspace;
  loading: boolean;
  error: string | null;
  saveError: string | null;
  busy: Busy[];
  pendingApproval: AiStreamEvent | null;
}

/** The workspace lives at app scope, not page scope: switching tools, going
 *  home or minimizing unmounts the page but must never interrupt generations.
 *  Only explicit stops, reset/clear, app exit and updates terminate requests. */
function createController(backend: AiBackend) {
  let workspace = createWorkspace();
  let loading = true;
  let error: string | null = null;
  let saveError: string | null = null;
  let busy: Busy[] = [];
  let pendingApproval: AiStreamEvent | null = null;
  let snapshot: Snapshot = { workspace, loading, error, saveError, busy, pendingApproval };
  const listeners = new Set<() => void>();
  const publish = () => {
    snapshot = { workspace, loading, error, saveError, busy, pendingApproval };
    for (const listener of listeners) listener();
  };

  let initialized = false;
  let queue: Promise<void> = Promise.resolve();
  const active = new Map<string, ActiveRequest>();
  const batch = new Map<string, { cancelled: boolean }>();
  const cancelling = new Map<string, Busy>();
  const cancelPending = new Map<string, Promise<void>>();
  let mutationsPending = 0;
  let exiting = 0;
  let progressTimer: ReturnType<typeof setTimeout> | null = null;
  let loadGeneration = 0;
  let started = false;

  const replace = (next: AiWorkspace) => {
    workspace = next;
    publish();
  };

  const activeIn = (conversationId: string) => {
    for (const request of active.values()) if (request.conversationId === conversationId) return request;
    return undefined;
  };

  const busyIn = (conversationId: string) => {
    if (activeIn(conversationId) || batch.has(conversationId)) return true;
    for (const request of cancelling.values()) if (request.conversationId === conversationId) return true;
    return false;
  };

  const generating = () => active.size > 0 || cancelling.size > 0 || batch.size > 0;

  const addBusy = (entry: Busy) => {
    busy = [...busy.filter(item => item.requestId !== entry.requestId), entry];
    publish();
  };

  const removeBusy = (requestId: string) => {
    busy = busy.filter(item => item.requestId !== requestId);
    publish();
  };

  /** All disk/credential mutations share this queue, preserving write order. */
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const pending = queue.then(operation);
    queue = pending.then(() => {}, () => {});
    return pending;
  };

  const persist = (snap = workspace): Promise<void> => {
    if (!initialized) return Promise.reject(new Error('AI 数据尚未成功加载，不能保存。'));
    // A regeneration only replaces its durable answer after success. If the
    // process crashes mid-stream, reopening still restores the previous reply.
    let durable = snap;
    for (const pending of active.values()) {
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
        await backend.save({ ...durable, providers: workspace.providers });
        saveError = null;
        publish();
      } catch (reason) {
        saveError = describeError(reason);
        publish();
        throw reason;
      }
    });
  };

  const saveQuietly = () => { void persist().catch(() => {}); };

  const update = (updater: Updater) => {
    if (!initialized || exiting || aiUpdatePending()) return;
    replace(updater(workspace));
    saveQuietly();
  };

  const changeConversation = (id: string, updater: (conversation: AiConversation) => AiConversation) => {
    replace({ ...workspace, conversations: workspace.conversations.map(chat => chat.id === id ? updater(chat) : chat) });
  };

  const tracker = createToolCallTracker({ changeConversation, saveQuietly, backend });
  tracker.subscribe(() => { pendingApproval = tracker.getPendingApproval(); publish(); });
  const { handleEvent: handleToolEvent, clear: clearToolApproval } = tracker;

  // touch 仅在请求结束时刷新 updatedAt；逐 token 刷新会让并发会话在侧边栏排序中交替跳顶。
  const changeReply = (request: ActiveRequest, updater: (message: AiMessage) => AiMessage, touch = false) => {
    changeConversation(request.conversationId, chat => ({ ...chat, ...(touch ? { updatedAt: Date.now() } : {}),
      ...(request.taskId ? { tasks: chat.tasks?.map(task => task.id === request.taskId ? { ...task, results: task.results.map(result => result.message.id === request.messageId ? { ...result, message: updater(result.message) } : result) } : task) }
        : { messages: chat.messages.map(message => message.id === request.messageId ? updater(message) : message) }) }));
  };

  const interruptTasks = () => {
    if (!batch.size) return;
    for (const running of batch.values()) running.cancelled = true;
    replace({ ...workspace, conversations: workspace.conversations.map(chat => ({ ...chat, tasks: chat.tasks?.map(task => ({ ...task,
      results: task.results.map(result => result.message.status === 'waiting' || result.message.status === 'streaming' ? { ...result, message: { ...result.message, status: 'interrupted' } } : result) })) })) });
  };

  const clearProgressTimer = () => {
    if (progressTimer !== null) clearTimeout(progressTimer);
    progressTimer = null;
  };

  const finish = async (request: ActiveRequest, status: AiMessage['status'], reason?: string) => {
    if (request.terminated || active.get(request.requestId) !== request) return;
    request.terminated = true;
    clearProgressTimer();
    changeReply(request, message => {
      if (status !== 'complete' && request.previous) return request.previous;
      const completed = { ...message, toolCalls: settlePendingCalls(message.toolCalls, '生成已结束，此调用未执行。'), status, error: reason, durationMs: Math.max(0, Date.now() - request.startedAt) };
      return status === 'complete' && request.previous ? retainAnswerVersion(request.previous, completed) : completed;
    }, true);
    active.delete(request.requestId);
    if (!cancelling.has(request.requestId)) busy = busy.filter(item => item.requestId !== request.requestId);
    if (reason) error = reason;
    publish();
    await persist();
  };

  const reload = async () => {
    if (generating()) { error = '请先停止当前生成，再重新加载数据。'; publish(); return; }
    const generation = ++loadGeneration;
    initialized = false;
    loading = true; error = null;
    publish();
    try {
      await queue;
      const saved = await backend.load();
      if (generation !== loadGeneration) return;
      if (saved && saved.version !== 1) throw new Error('不支持此 AI 数据版本，请保留数据并升级应用。');
      const next = saved ?? createWorkspace();
      if (!Array.isArray(next.assistants) || !next.assistants.length || !Array.isArray(next.conversations) || !Array.isArray(next.providers)) {
        throw new Error('AI 数据结构损坏，请打开数据目录检查备份。');
      }
      // Establish complete default metadata before provider/credential commands
      // can operate, so a first-run interruption never leaves providers alone.
      if (!saved) await enqueue(() => backend.save(next));
      if (generation !== loadGeneration) return;
      const recovered: AiWorkspace = { ...next, conversations: next.conversations.map(chat => ({ ...chat,
        messages: chat.messages.map(message => message.status === 'waiting' || message.status === 'streaming' ? { ...message, status: 'interrupted', toolCalls: settlePendingCalls(message.toolCalls, '回复意外中断，此调用未执行。') } : message),
        tasks: chat.tasks?.map(task => ({ ...task, results: task.results.map(result => ({ ...result, message: result.message.status === 'waiting' || result.message.status === 'streaming' ? { ...result.message, status: 'interrupted', toolCalls: settlePendingCalls(result.message.toolCalls, '回复意外中断，此调用未执行。') } : result.message })) })),
      })) };
      initialized = true;
      replace(recovered);
      saveError = null;
      publish();
    } catch (reason) {
      if (generation === loadGeneration) { error = describeError(reason); publish(); }
    } finally {
      if (generation === loadGeneration) { loading = false; publish(); }
    }
  };

  const run = async (conversationId: string, options: AiSendOptions = {}, regenerate = false): Promise<AiSendOutcome> => {
    if (exiting || aiUpdatePending()) return { type: 'not-sent', reason: '应用正在保存退出或更新' };
    if (!initialized) { error = 'AI 数据尚未加载，请先恢复数据。'; publish(); return { type: 'not-sent', reason: 'AI 数据尚未加载' }; }
    if (busyIn(conversationId)) { error = '该会话正在生成，请先停止后再发送。'; publish(); return { type: 'not-sent', reason: '已有生成任务' }; }
    if (mutationsPending) { error = '正在保存或修改 AI 配置，请完成后再发送消息。'; publish(); return { type: 'not-sent', reason: '配置正在保存' }; }
    error = null;
    publish();
    let request: ActiveRequest | undefined;
    let unsavedDraft: Pick<AiConversation, 'draft' | 'draftAttachments'> | undefined;
    let networkStarted = false;
    try {
      const current = workspace;
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
      active.set(request.requestId, request);
      addBusy({ requestId: request.requestId, conversationId, messageId: request.messageId });
      // Never start the network until input and attachment copies have reached disk.
      await persist();
      if (active.get(request.requestId) !== request || request.terminated) return { type: 'settled', requestId: request.requestId };
      const running = request;
      const onEvent = (event: AiStreamEvent) => {
        if (active.get(running.requestId) !== running || running.terminated || event.requestId !== running.requestId
          || event.conversationId !== running.conversationId || event.messageId !== running.messageId) return;
        if (event.type === 'thinking') {
          changeConversation(conversationId, value => ({ ...value, messages: value.messages.map(message => message.id === running.messageId ? { ...message, thinking: `${message.thinking ?? ''}${event.text ?? ''}`, status: 'streaming' } : message) }));
          if (progressTimer === null) progressTimer = setTimeout(() => { progressTimer = null; saveQuietly(); }, 500);
        } else if (event.type === 'delta') {
          changeConversation(conversationId, value => ({ ...value, messages: value.messages.map(message => message.id === running.messageId
            ? { ...message, content: message.content + (event.text ?? ''), status: 'streaming', firstTokenMs: message.firstTokenMs ?? Math.max(0, Date.now() - running.startedAt) } : message) }));
          if (progressTimer === null) progressTimer = setTimeout(() => {
            progressTimer = null;
            saveQuietly();
          }, 500);
        } else if (event.type === 'metadata') {
          changeConversation(conversationId, value => ({ ...value, messages: value.messages.map(message => message.id === running.messageId ? { ...message, finishReason: event.finishReason ?? message.finishReason, usage: event.usage ?? message.usage } : message) }));
        } else if (event.type === 'round_reset') {
          changeConversation(conversationId, value => ({ ...value, messages: value.messages.map(message => message.id === running.messageId ? { ...message, content: '', thinking: undefined, status: 'streaming' } : message) }));
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
      if (active.get(running.requestId) === running && !running.terminated) await finish(running, 'interrupted', '回复流意外结束，请重试。');
    } catch (reason) {
      const text = describeError(reason);
      if (request && active.get(request.requestId) === request && !request.terminated) {
        if (!networkStarted && unsavedDraft) {
          const originalDraft = unsavedDraft;
          changeConversation(conversationId, value => !value.draft && !value.draftAttachments.length ? { ...value, ...originalDraft } : value);
        }
        await finish(request, 'failed', text).catch(() => {});
      } else if (!request || !request.terminated) {
        error = text;
        publish();
      }
    }
    return request ? { type: 'settled', requestId: request.requestId } : { type: 'not-sent', reason: '请求未发送' };
  };

  const send = (id: string, options?: AiSendOptions) => run(id, options);
  const regenerate = (id: string, options: AiSendOptions = {}) => run(id, options, true);

  const runTask = async (conversationId: string, plan: AiTaskPlan) => {
    if (!initialized || exiting || aiUpdatePending() || busyIn(conversationId) || mutationsPending) throw new Error('请先完成当前操作，再运行任务。');
    const chat = workspace.conversations.find(chat => chat.id === conversationId);
    if (!chat || !plan.requests.length || plan.requests.some(request => request.conversationId !== conversationId)) throw new Error('任务会话无效');
    for (const request of plan.requests) {
      const provider = workspace.providers.find(provider => provider.id === request.providerId && provider.enabled);
      if (!provider || !provider.models.some(model => model.id === request.modelId) || !plan.targets.includes(providerTarget(provider))) throw new Error('任务目标已更改，请重新创建任务');
    }
    const runningBatch = { cancelled: false }; batch.set(conversationId, runningBatch);
    addBusy({ requestId: plan.requests[0].requestId, conversationId, messageId: plan.requests[0].messageId });
    error = null;
    publish();
    changeConversation(conversationId, chat => ({ ...chat, tasks: [...(chat.tasks ?? []), { id: plan.id, kind: plan.kind, createdAt: plan.createdAt, prompt: plan.prompt, results: plan.results }], approvedTargets: [...new Set([...chat.approvedTargets, ...plan.targets])] }));
    try {
      await persist();
      for (const request of plan.requests) {
        if (runningBatch.cancelled || exiting || aiUpdatePending()) break;
        const running: ActiveRequest = { requestId: request.requestId, conversationId, messageId: request.messageId, startedAt: Date.now(), terminated: false, taskId: plan.id };
        active.set(running.requestId, running); addBusy({ requestId: running.requestId, conversationId, messageId: request.messageId });
        try {
          await backend.generate({ ...request, messages: requestMessages(request.messages) }, event => {
            if (active.get(running.requestId) !== running || running.terminated || event.requestId !== running.requestId || event.conversationId !== conversationId || event.messageId !== running.messageId) return;
            if (event.type === 'thinking') {
              changeReply(running, message => ({ ...message, thinking: `${message.thinking ?? ''}${event.text ?? ''}`, status: 'streaming' }));
              if (progressTimer === null) progressTimer = setTimeout(() => { progressTimer = null; saveQuietly(); }, 500);
            } else if (event.type === 'delta') {
              changeReply(running, message => ({ ...message, content: message.content + (event.text ?? ''), status: 'streaming', firstTokenMs: message.firstTokenMs ?? Math.max(0, Date.now() - running.startedAt) }));
              if (progressTimer === null) progressTimer = setTimeout(() => { progressTimer = null; saveQuietly(); }, 500);
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
          if (active.get(running.requestId) === running && !running.terminated) await finish(running, 'interrupted', '任务回复流意外结束');
        } catch (reason) { if (active.get(running.requestId) === running && !running.terminated) await finish(running, 'failed', describeError(reason)); }
        await persist();
      }
    } catch (reason) { runningBatch.cancelled = true; error = describeError(reason); publish(); }
    finally {
      changeConversation(conversationId, chat => ({ ...chat, tasks: chat.tasks?.map(task => task.id === plan.id ? { ...task, results: task.results.map(result => result.message.status === 'waiting' ? { ...result, message: { ...result.message, status: 'stopped' } } : result) } : task) }));
      if (batch.get(conversationId) === runningBatch) batch.delete(conversationId);
      busy = busy.filter(item => item.conversationId !== conversationId || cancelling.has(item.requestId));
      publish();
      await persist().catch(() => {});
    }
  };

  const stop = (conversationId?: string): Promise<void> => {
    const batchIds = conversationId ? (batch.has(conversationId) ? [conversationId] : []) : [...batch.keys()];
    if (batchIds.length) {
      for (const id of batchIds) batch.get(id)!.cancelled = true;
      replace({ ...workspace, conversations: workspace.conversations.map(chat => batchIds.includes(chat.id) ? { ...chat, tasks: chat.tasks?.map(task => ({ ...task, results: task.results.map(result => result.message.status === 'waiting' ? { ...result, message: { ...result.message, status: 'stopped' } } : result) })) } : chat) });
    }
    const targets = [...active.values()].filter(request => !conversationId || request.conversationId === conversationId);
    if (!targets.length) return persist().catch(() => {});
    const pendings: Promise<void>[] = [];
    for (const request of targets) {
      const existing = cancelPending.get(request.conversationId);
      if (existing) { pendings.push(existing); continue; }
      cancelling.set(request.requestId, request);
      clearToolApproval(request.conversationId);
      const saved = finish(request, 'stopped').catch(() => {});
      const pending = (async () => {
        try { await backend.cancel(request.requestId); }
        catch (reason) { error = describeError(reason); publish(); }
        finally {
          cancelling.delete(request.requestId);
          cancelPending.delete(request.conversationId);
          removeBusy(request.requestId);
        }
        await saved;
      })();
      cancelPending.set(request.conversationId, pending);
      pendings.push(pending);
    }
    return Promise.all(pendings).then(() => {});
  };

  const saveProvider = async (provider: AiProvider, apiKey?: string) => {
    if (exiting || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    if (!initialized) throw new Error('AI 数据尚未加载，不能修改服务。');
    if (generating()) throw new Error('请先停止生成，再修改模型服务。');
    mutationsPending++;
    try {
      await enqueue(async () => {
        const saved = await backend.saveProvider(provider, apiKey);
        const providers = workspace.providers.filter(item => item.id !== saved.id);
        replace({ ...workspace, providers: [...providers, saved] });
      });
      await persist();
    } catch (reason) { error = describeError(reason); publish(); throw reason; }
    finally { mutationsPending--; }
  };

  const removeProvider = async (id: string) => {
    if (exiting || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    if (!initialized) throw new Error('AI 数据尚未加载，不能删除服务。');
    if (generating()) throw new Error('请先停止生成，再删除模型服务。');
    mutationsPending++;
    try {
      await enqueue(async () => {
        await backend.removeProvider(id);
        replace({ ...workspace, providers: workspace.providers.filter(provider => provider.id !== id) });
      });
      await persist();
    } catch (reason) { error = describeError(reason); publish(); throw reason; }
    finally { mutationsPending--; }
  };

  const clearHistory = async () => {
    if (exiting || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    if (!initialized) throw new Error('AI 数据尚未加载，不能清空历史。');
    mutationsPending++;
    try {
      if (generating()) await stop();
      replace({ ...workspace, conversations: [], activeConversationId: undefined });
      await persist();
    } finally { mutationsPending--; }
  };

  const reset = async () => {
    if (exiting || aiUpdatePending()) throw new Error('应用正在保存并准备退出，请稍后修改 AI 数据。');
    mutationsPending++;
    try {
      if (generating()) await stop();
      loading = true;
      publish();
      initialized = false;
      await enqueue(async () => {
        await backend.reset();
        const next = createWorkspace();
        replace(next);
        await backend.save(next);
      });
      initialized = true;
      error = null; saveError = null; loading = false;
      publish();
    } catch (reason) {
      loading = false; error = describeError(reason); saveError = describeError(reason);
      publish();
      throw reason;
    } finally { mutationsPending--; }
  };

  const start = () => {
    if (started) return;
    started = true;
    void reload();
    if (!backend.onExitRequested) return;
    // Registered once per backend for the app lifetime, so background
    // generations are still flushed when the page is not mounted.
    void backend.onExitRequested(async hold => {
      exiting++;
      interruptTasks();
      let retained = false;
      try {
        const requests = [...active.values()];
        if (requests.length) {
          const results = await Promise.allSettled(requests.flatMap(request => [
            finish(request, 'interrupted'), backend.cancel(request.requestId),
          ]));
          for (const result of results) if (result.status === 'rejected') throw result.reason;
        }
        await queue;
        if (initialized) await persist();
        if (hold) {
          retained = true;
          let released = false;
          return () => { if (!released) { released = true; exiting--; } };
        }
      } catch (reason) {
        error = describeError(reason);
        publish();
        throw reason;
      } finally { if (!retained) exiting--; }
    }).catch(reason => { error = describeError(reason); publish(); });
  };

  return {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    start,
    update, reload, send, regenerate, runTask, stop, saveProvider, removeProvider, clearHistory, reset,
    decideTool: tracker.decide,
    answerTool: tracker.answer,
    clearToolApproval: tracker.clear,
  };
}

type Controller = ReturnType<typeof createController>;
let controllers = new WeakMap<AiBackend, Controller>();
const getController = (backend: AiBackend) => {
  let controller = controllers.get(backend);
  if (!controller) {
    controller = createController(backend);
    controllers.set(backend, controller);
  }
  return controller;
};

/** Page tests reuse one mocked backend object across cases; isolate them. */
export function resetAiWorkspaceCache() { controllers = new WeakMap(); }

export function useAiWorkspace(backend: AiBackend) {
  const controller = getController(backend);
  const updatePending = useSyncExternalStore(subscribeAiUpdate, aiUpdatePending, aiUpdatePending);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => { controller.start(); }, [controller]);
  return {
    workspace: state.workspace,
    loading: state.loading || updatePending,
    updating: updatePending,
    error: state.error,
    saveError: state.saveError,
    busy: state.busy,
    update: controller.update,
    reload: controller.reload,
    send: controller.send,
    regenerate: controller.regenerate,
    runTask: controller.runTask,
    stop: controller.stop,
    saveProvider: controller.saveProvider,
    removeProvider: controller.removeProvider,
    clearHistory: controller.clearHistory,
    reset: controller.reset,
    toolCalls: {
      pendingApproval: state.pendingApproval,
      decide: controller.decideTool,
      answer: controller.answerTool,
      clear: controller.clearToolApproval,
    },
  };
}