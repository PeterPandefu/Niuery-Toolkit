import { nanoid } from 'nanoid';
import type { AiAnswerVersion, AiConversation, AiMessage } from './types';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function forkConversation(conversation: AiConversation, messageId: string): AiConversation {
  const index = conversation.messages.findIndex(message => message.id === messageId);
  if (index < 0) throw new Error('消息不存在');
  const message = conversation.messages[index];
  return { ...clone(conversation), id: nanoid(), title: `${conversation.title} · 分支`, parentConversationId: conversation.id,
    messages: clone(conversation.messages.slice(0, index + (message.role === 'user' ? 0 : 1))),
    draft: message.role === 'user' ? message.content : '', draftAttachments: message.role === 'user' ? clone(message.attachments) : [],
    approvedTargets: [], tasks: [], pinned: false, archived: false, updatedAt: Date.now() };
}

function answerSnapshot(message: AiMessage): AiAnswerVersion {
  return { content: message.content, thinking: message.thinking, createdAt: message.createdAt, status: message.status, modelId: message.modelId, providerId: message.providerId,
    error: message.error, usage: message.usage, finishReason: message.finishReason, firstTokenMs: message.firstTokenMs, durationMs: message.durationMs };
}

export function retainAnswerVersion(previous: AiMessage, next: AiMessage): AiMessage {
  const versions = [...(previous.versions?.length ? previous.versions : [answerSnapshot(previous)]), answerSnapshot(next)];
  return { ...next, versions, selectedVersion: versions.length - 1 };
}

export function selectAnswerVersion(message: AiMessage, index: number): AiMessage {
  const version = message.versions?.[index];
  if (!Number.isInteger(index) || !version) throw new Error('回复版本不存在');
  return { ...message, thinking: undefined, error: undefined, usage: undefined, finishReason: undefined, firstTokenMs: undefined, durationMs: undefined,
    providerId: undefined, modelId: undefined, ...version, selectedVersion: index };
}

export function continueFromSummary(conversation: AiConversation, summary: string): AiConversation {
  if (!summary.trim()) throw new Error('请先填写摘要');
  return { ...clone(conversation), id: nanoid(), title: `${conversation.title} · 接续`, parentConversationId: conversation.id, summary: summary.trim(),
    messages: [], tasks: [], draft: '', draftAttachments: [], approvedTargets: [], excludedMessageIds: [], pinned: false, archived: false, updatedAt: Date.now() };
}

export function summarySource(conversation: AiConversation, rounds: number): string {
  const pairs: AiMessage[][] = [];
  for (let index = 0; index < conversation.messages.length - 1; index++) {
    const question = conversation.messages[index]; const answer = conversation.messages[index + 1];
    if (question.role === 'user' && answer.role === 'assistant' && question.status === 'complete' && answer.status === 'complete') { pairs.push([question, answer]); index++; }
  }
  return pairs.slice(-Math.max(1, Math.floor(rounds))).flat().map(message => `${message.role}: ${message.content}${message.attachments.length ? `\n附件 / Attachments: ${message.attachments.map(file => file.name).join(', ')}` : ''}`).join('\n\n');
}
