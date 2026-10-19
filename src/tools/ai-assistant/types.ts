export type AiProviderKind = 'openai' | 'ollama';

export interface AiModel {
  id: string;
  name: string;
  supportsImages: boolean;
}

export interface AiProvider {
  id: string;
  name: string;
  kind: AiProviderKind;
  baseUrl: string;
  hasApiKey: boolean;
  models: AiModel[];
  enabled: boolean;
}

export interface AiParameters {
  historyRounds: number;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiAssistant {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  providerId?: string;
  modelId?: string;
  parameters: AiParameters;
}

export interface AiAttachment {
  id: string;
  name: string;
  kind: 'image' | 'text';
  mimeType: string;
  size: number;
  /** Text content, or raw base64 for images (without the data URL prefix). */
  data: string;
}

export type AiMessageStatus = 'waiting' | 'streaming' | 'complete' | 'stopped' | 'failed' | 'interrupted';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: AiAttachment[];
  createdAt: number;
  status: AiMessageStatus;
  providerId?: string;
  modelId?: string;
  error?: string;
}

export interface AiConversation {
  id: string;
  assistantId: string;
  title: string;
  systemPrompt: string;
  providerId?: string;
  modelId?: string;
  parameters: AiParameters;
  messages: AiMessage[];
  draft: string;
  draftAttachments: AiAttachment[];
  approvedTargets: string[];
  updatedAt: number;
}

export interface AiWorkspace {
  version: 1;
  providers: AiProvider[];
  assistants: AiAssistant[];
  conversations: AiConversation[];
  activeAssistantId: string;
  activeConversationId?: string;
}

export interface AiRequest {
  requestId: string;
  conversationId: string;
  messageId: string;
  providerId: string;
  modelId: string;
  systemPrompt: string;
  parameters: AiParameters;
  messages: AiMessage[];
}

export interface AiStreamEvent {
  requestId: string;
  conversationId: string;
  messageId: string;
  type: 'delta' | 'done' | 'error' | 'stopped';
  text?: string;
  error?: string;
}

/** A held flush blocks edits until its returned release callback runs. */
export type AiFlushHandler = (hold?: boolean) => Promise<void | (() => void)>;

export interface AiBackend {
  onExitRequested?(handler: AiFlushHandler): Promise<() => void>;
  load(): Promise<AiWorkspace | null>;
  save(workspace: AiWorkspace): Promise<void>;
  saveProvider(provider: AiProvider, apiKey?: string): Promise<AiProvider>;
  removeProvider(providerId: string): Promise<void>;
  listModels(providerId: string): Promise<AiModel[]>;
  testConnection(providerId: string): Promise<string>;
  generate(request: AiRequest, onEvent: (event: AiStreamEvent) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
  openDataDirectory(): Promise<void>;
  reset(): Promise<void>;
}
