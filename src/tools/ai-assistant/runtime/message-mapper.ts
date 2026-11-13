import type { ThreadMessageLike } from '@assistant-ui/react';
import type { AiMessage, AiToolCall } from '../types';

type AiJsonValue = string | number | boolean | null | AiJsonValue[] | { [key: string]: AiJsonValue };

type AiPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: { [key: string]: AiJsonValue }; argsText: string; result?: string; isError?: boolean };

function toolCallPart(call: AiToolCall): AiPart {
  let args: { [key: string]: AiJsonValue } = {};
  try {
    const parsed: unknown = JSON.parse(call.arguments);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as { [key: string]: AiJsonValue };
  } catch { /* Keep the raw text; a malformed argument record still renders. */ }
  return {
    type: 'tool-call', toolCallId: call.id, toolName: call.name, args, argsText: call.arguments,
    ...(call.result === undefined ? {} : { result: call.result }),
    ...(call.status === 'failed' || call.status === 'rejected' ? { isError: true } : {}),
  };
}

export function mapAiMessage(message: AiMessage, showThinking = true): ThreadMessageLike {
  const content: AiPart[] = [];
  if (message.role === 'assistant' && showThinking && message.thinking) content.push({ type: 'reasoning', text: message.thinking });
  if (message.role === 'assistant') for (const call of message.toolCalls ?? []) content.push(toolCallPart(call));
  content.push({ type: 'text', text: message.content });
  const common = { id: message.id, role: message.role, createdAt: new Date(message.createdAt), content };
  if (message.role === 'user') return { ...common, content: [{ type: 'text', text: message.content }], attachments: message.attachments.map(file => ({
    id: file.id, name: file.name, type: file.kind === 'image' ? 'image' : 'document', contentType: file.mimeType, status: { type: 'complete' as const },
    content: file.kind === 'image' ? [{ type: 'image' as const, image: `data:${file.mimeType};base64,${file.data}` }] : [{ type: 'text' as const, text: file.data }],
  })) };
  let status: ThreadMessageLike['status'];
  if (message.status === 'waiting' || message.status === 'streaming') status = { type: 'running' };
  else if (message.status === 'stopped') status = { type: 'incomplete', reason: 'cancelled' };
  else if (message.status === 'failed') status = { type: 'incomplete', reason: 'error', error: message.error };
  else if (message.status === 'interrupted') status = { type: 'incomplete', reason: 'other' };
  else if (message.finishReason === 'length') status = { type: 'incomplete', reason: 'length' };
  else if (message.finishReason === 'content_filter') status = { type: 'incomplete', reason: 'content-filter' };
  else status = { type: 'complete', reason: 'stop' };
  return { ...common, status, metadata: { custom: { sourceMessageId: message.id, selectedVersion: message.selectedVersion } } };
}
