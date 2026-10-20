import type { AiConversation } from './types';

export function searchConversations(conversations: AiConversation[], query: string, assistantId: string, archived: boolean) {
  const needle = query.trim().toLocaleLowerCase();
  return conversations.flatMap(conversation => {
    if (!needle && (conversation.assistantId !== assistantId || !!conversation.archived !== archived)) return [];
    const allMessages = [...conversation.messages, ...(conversation.tasks ?? []).flatMap(task => task.results.map(result => result.message))];
    const message = needle ? allMessages.find(message => message.content.toLocaleLowerCase().includes(needle) || message.attachments.some(file => file.name.toLocaleLowerCase().includes(needle))) : undefined;
    const extra = [conversation.summary ?? '', ...(conversation.tasks ?? []).map(task => task.prompt)].find(text => needle && text.toLocaleLowerCase().includes(needle));
    if (needle && !conversation.title.toLocaleLowerCase().includes(needle) && !message && !extra) return [];
    const text = message?.content ?? extra ?? '';
    const offset = Math.max(0, text.toLocaleLowerCase().indexOf(needle) - 30);
    return [{ conversation, messageId: message?.id, excerpt: text.slice(offset, offset + 120) }];
  }).sort((left, right) => Number(!!right.conversation.pinned) - Number(!!left.conversation.pinned) || right.conversation.updatedAt - left.conversation.updatedAt);
}

export function quoteDraft(draft: string, text: string): string {
  return `${draft ? `${draft}\n\n` : ''}${text.split(/\r?\n/).map(line => `> ${line}`).join('\n')}\n\n`;
}

export function templateVariables(content: string): string[] {
  return [...new Set([...content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map(match => match[1]))];
}

export function applyTemplate(content: string, variables: Record<string, string>): string {
  for (const variable of templateVariables(content)) if (!variables[variable]?.trim()) throw new Error(`请填写模板变量 / Missing variable: ${variable}`);
  return content.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, name: string) => variables[name]);
}
