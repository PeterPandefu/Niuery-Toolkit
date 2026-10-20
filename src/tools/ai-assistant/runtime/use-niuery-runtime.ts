import { useMemo } from 'react';
import { useExternalStoreRuntime, type AppendMessage } from '@assistant-ui/react';
import type { AiMessage, AiProvider } from '../types';
import { shouldShowThinking } from '../model';
import { mapAiMessage } from './message-mapper';

export interface AiRuntimeActions {
  append(message: AppendMessage): Promise<void>;
  reload(parentId: string | null): Promise<void>;
  cancel(): Promise<void>;
  edit?(message: AppendMessage): Promise<void>;
}

const ignore = async () => {};

export function useNiueryRuntime({ messages, providers, actions, running = false, disabled = false, sendDisabled = false, activeRunId, hasEarlier, onLoadEarlier }: {
  messages: AiMessage[]; providers: AiProvider[]; actions?: AiRuntimeActions; running?: boolean; disabled?: boolean; sendDisabled?: boolean; activeRunId?: string; hasEarlier?: boolean; onLoadEarlier?(): Promise<void>;
}) {
  const convertMessage = useMemo(() => (message: AiMessage) => mapAiMessage(message, shouldShowThinking(message, providers)), [providers]);
  return useExternalStoreRuntime<AiMessage>({
    messages, convertMessage, hasEarlier, onLoadEarlier, isRunning: running, isDisabled: disabled || !actions,
    isSendDisabled: sendDisabled, activeRunId,
    onNew: actions?.append ?? ignore,
    onReload: actions ? parentId => actions.reload(parentId) : undefined,
    onCancel: actions?.cancel,
    onEdit: actions?.edit,
  });
}
