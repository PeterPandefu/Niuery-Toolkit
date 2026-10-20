import type { AiMessage } from './types';

/** Only conversational content is eligible for the provider context. */
export function requestMessages(messages: AiMessage[]): AiMessage[] {
  return messages.map(message => ({ id: message.id, role: message.role, content: message.content, attachments: message.attachments, createdAt: message.createdAt, status: message.status }));
}
