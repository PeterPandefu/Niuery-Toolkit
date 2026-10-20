import { nanoid } from 'nanoid';
import type { AiAssistant, AiConversation, AiMessage, AiModel, AiProvider, AiWorkspace } from './types';

/** Keep the first entry so existing aliases and image capabilities survive a refresh. */
export function uniqueModels(models: AiModel[]): AiModel[] {
  const result = new Map<string, AiModel>();
  for (const model of models) {
    const id = model.id.trim();
    if (id && !result.has(id)) result.set(id, { ...model, id, name: model.name.trim() || id });
  }
  return [...result.values()];
}

export function createWorkspace(): AiWorkspace {
  const assistants: AiAssistant[] = [
    { id: nanoid(), name: '通用助手', description: '日常问答、写作与分析', systemPrompt: '你是一位严谨、友善的中文 AI 助手。请提供准确、清晰的回答。', parameters: { historyRounds: 20 } },
    { id: nanoid(), name: '编程助手', description: '代码分析、调试与开发建议', systemPrompt: '你是一位编程助手。请先理解需求，给出准确、可操作的代码和解释，说明不确定之处。', parameters: { historyRounds: 20 } },
    { id: nanoid(), name: '翻译助手', description: '多语言翻译与表达润色', systemPrompt: '你是一位专业翻译助手。请保持原意和语气，提供自然、准确的译文；目标语言不明确时请先确认。', parameters: { historyRounds: 20 } },
  ];
  return { version: 1, providers: [], assistants, conversations: [], activeAssistantId: assistants[0].id };
}

export function newConversation(assistant: AiAssistant): AiConversation {
  return {
    id: nanoid(), assistantId: assistant.id, title: '新会话', systemPrompt: assistant.systemPrompt,
    providerId: assistant.providerId, modelId: assistant.modelId, parameters: { ...assistant.parameters },
    messages: [], draft: '', draftAttachments: [], approvedTargets: [], updatedAt: Date.now(),
  };
}

/** Stable consent target; a changed address requires another explicit approval. */
export function providerTarget(provider: Pick<AiProvider, 'id' | 'baseUrl'>): string {
  return `${provider.id}:${provider.baseUrl.trim().replace(/\/+$/, '')}`;
}

export function shouldShowThinking(message: AiMessage, providers: AiProvider[]): boolean {
  return providers.find(provider => provider.id === message.providerId)?.models.find(model => model.id === message.modelId)?.showThinking !== false;
}

/** Only complete historical user/answer pairs are eligible for transmission. */
export function buildContext(conversation: AiConversation): AiMessage[] {
  const { messages } = conversation;
  let currentIndex = messages.length - 1;
  while (currentIndex >= 0 && messages[currentIndex].role !== 'user') currentIndex--;
  if (currentIndex < 0) return [];
  const rounds: AiMessage[][] = [];
  for (let index = 0; index < currentIndex - 1; index++) {
    const question = messages[index];
    const answer = messages[index + 1];
    if (question.role === 'user' && question.status === 'complete' && answer.role === 'assistant' && answer.status === 'complete') {
      rounds.push([question, answer]);
      index++;
    }
  }
  const configured = conversation.parameters.historyRounds;
  const count = Number.isFinite(configured) ? Math.min(100, Math.max(0, Math.floor(configured))) : 20;
  return [...(count ? rounds.slice(-count).flat() : []), messages[currentIndex]];
}

export function exportConversation(conversation: AiConversation, format: 'markdown' | 'json'): string {
  // Explicitly select fields, so future transient state or credentials cannot enter archives.
  const attachment = (value: AiMessage['attachments'][number]) => ({
    id: value.id, name: value.name, kind: value.kind, mimeType: value.mimeType, size: value.size, data: value.data, sourceDocument: value.sourceDocument,
  });
  const archiveMessage = (message: AiMessage): AiMessage => ({
    id: message.id, role: message.role, content: message.content, attachments: message.attachments.map(attachment), createdAt: message.createdAt, status: message.status,
    providerId: message.providerId, modelId: message.modelId, error: message.error, thinking: message.thinking, finishReason: message.finishReason,
    usage: message.usage && { inputTokens: message.usage.inputTokens, outputTokens: message.usage.outputTokens, totalTokens: message.usage.totalTokens }, firstTokenMs: message.firstTokenMs, durationMs: message.durationMs,
    versions: message.versions?.map(version => ({ content: version.content, thinking: version.thinking, createdAt: version.createdAt, status: version.status, modelId: version.modelId, providerId: version.providerId, error: version.error, usage: version.usage && { inputTokens: version.usage.inputTokens, outputTokens: version.usage.outputTokens, totalTokens: version.usage.totalTokens }, finishReason: version.finishReason, firstTokenMs: version.firstTokenMs, durationMs: version.durationMs })), selectedVersion: message.selectedVersion,
  });
  const archive: AiConversation = {
    id: conversation.id, assistantId: conversation.assistantId, title: conversation.title,
    systemPrompt: conversation.systemPrompt, providerId: conversation.providerId, modelId: conversation.modelId,
    parameters: { historyRounds: conversation.parameters.historyRounds, temperature: conversation.parameters.temperature, maxOutputTokens: conversation.parameters.maxOutputTokens },
    messages: conversation.messages.map(archiveMessage),
    draft: conversation.draft, draftAttachments: conversation.draftAttachments.map(attachment),
    approvedTargets: [...conversation.approvedTargets], updatedAt: conversation.updatedAt, excludedMessageIds: conversation.excludedMessageIds, pinned: conversation.pinned, archived: conversation.archived,
    parentConversationId: conversation.parentConversationId, summary: conversation.summary,
    tasks: conversation.tasks?.map(task => ({ id: task.id, kind: task.kind, createdAt: task.createdAt, prompt: task.prompt, results: task.results.map(result => ({ label: result.label, target: result.target, message: archiveMessage(result.message) })) })),
  };
  if (format === 'json') return JSON.stringify(archive, null, 2);
  const exportThinking = (text?: string) => text ? `\n\n<details><summary>思考过程 / Thinking</summary>\n<pre>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>\n</details>` : '';
  return `# ${conversation.title}\n\n${conversation.messages.map(message => {
    const metadata = message.role === 'assistant' ? `\n\n模型：${message.modelId ?? '未记录'} · 状态：${message.status}` : '';
    const attachments = message.attachments.length ? `\n\n附件：${message.attachments.map(file => file.name).join('、')}` : '';
    const thinking = exportThinking(message.thinking);
    return `## ${message.role === 'user' ? '用户' : '助手'}\n\n${message.content}${thinking}${attachments}${metadata}`;
  }).join('\n\n---\n\n')}${conversation.summary ? `\n\n## 接续摘要\n\n${conversation.summary}` : ''}${(conversation.tasks ?? []).map(task => `\n\n## ${task.kind === 'comparison' ? '模型对比' : '会话摘要'}\n\n${task.prompt}\n\n${task.results.map(result => `### ${result.label}\n\n${result.message.content}${exportThinking(result.message.thinking)}\n\n状态：${result.message.status}`).join('\n\n')}`).join('')}\n`;
}
