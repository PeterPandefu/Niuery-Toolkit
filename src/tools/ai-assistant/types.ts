export type AiProviderKind = 'openai' | 'ollama';

export interface AiModel {
  id: string;
  name: string;
  supportsImages: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTemperature?: boolean;
  outputTokenParameter?: 'max_tokens' | 'max_completion_tokens';
  streamUsage?: boolean;
  /** Display provider-returned thinking; omission keeps it visible. */
  showThinking?: boolean;
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
  sourceDocument?: { name: string; pages: number };
}

export type AiMessageStatus = 'waiting' | 'streaming' | 'complete' | 'stopped' | 'failed' | 'interrupted';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Explicit reasoning/thinking text returned by the provider, kept separate from the answer. */
  thinking?: string;
  attachments: AiAttachment[];
  createdAt: number;
  status: AiMessageStatus;
  providerId?: string;
  modelId?: string;
  error?: string;
  finishReason?: string;
  usage?: AiUsage;
  firstTokenMs?: number;
  durationMs?: number;
  versions?: AiAnswerVersion[];
  selectedVersion?: number;
}

export type AiAnswerVersion = Pick<AiMessage, 'content' | 'thinking' | 'createdAt' | 'status' | 'modelId' | 'providerId' | 'error' | 'usage' | 'finishReason' | 'firstTokenMs' | 'durationMs'>;

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
  excludedMessageIds?: string[];
  pinned?: boolean;
  archived?: boolean;
  parentConversationId?: string;
  summary?: string;
  tasks?: AiTask[];
}

export interface AiTaskResult { label: string; target: string; message: AiMessage }
export interface AiTask { id: string; kind: 'comparison' | 'summary'; createdAt: number; prompt: string; results: AiTaskResult[] }
export interface AiTaskPlan extends AiTask { targets: string[]; requests: AiRequest[]; droppedRounds: number }

export interface AiWorkspace {
  version: 1;
  providers: AiProvider[];
  assistants: AiAssistant[];
  conversations: AiConversation[];
  activeAssistantId: string;
  activeConversationId?: string;
  templates?: AiPromptTemplate[];
}

export interface AiPromptTemplate { id: string; name: string; content: string; favorite?: boolean }

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
  type: 'delta' | 'thinking' | 'done' | 'error' | 'stopped' | 'metadata';
  text?: string;
  error?: string;
  finishReason?: string;
  usage?: AiUsage;
}

export interface AiUsage { inputTokens: number; outputTokens: number; totalTokens: number }

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
  testModel?(providerId: string, modelId: string): Promise<string>;
  generate(request: AiRequest, onEvent: (event: AiStreamEvent) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
  openDataDirectory(): Promise<void>;
  reset(): Promise<void>;
}
