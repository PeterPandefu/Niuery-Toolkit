import { memo, useCallback, useMemo } from 'react';
import { ThreadPrimitive, type MessageState } from '@assistant-ui/react';
import type { AiMessage } from '../types';
import { MessageView } from '../message-view';

export interface ConversationMessageActions {
  edit(message: AiMessage): void;
  fork(message: AiMessage): void;
  quote(text: string): void;
  version(messageId: string, index: number): void;
}

const ConversationMessageRow = memo(function ConversationMessageRow({ message, disabled, latest, actions }: {
  message: AiMessage; disabled: boolean; latest: boolean; actions: ConversationMessageActions;
}) {
  return <MessageView frameworkActions message={message} disabled={disabled} lastAssistant={latest}
    onEdit={actions.edit} onFork={actions.fork} onQuote={actions.quote}
    onVersion={index => actions.version(message.id, index)} onRegenerate={() => {}} />;
});

export const ConversationMessages = memo(function ConversationMessages({ messages, disabled, latestAssistantId, actions }: {
  messages: AiMessage[]; disabled: boolean; latestAssistantId?: string; actions: ConversationMessageActions;
}) {
  const byId = useMemo(() => new Map(messages.map(message => [message.id, message])), [messages]);
  const renderMessage = useCallback(({ message: projected }: { message: MessageState }) => {
    const message = byId.get(projected.id);
    return message ? <ConversationMessageRow message={message} disabled={disabled} latest={message.id === latestAssistantId} actions={actions} /> : null;
  }, [actions, byId, disabled, latestAssistantId]);
  return <ThreadPrimitive.Messages>{renderMessage}</ThreadPrimitive.Messages>;
});
