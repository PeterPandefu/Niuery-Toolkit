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

export type AiToolCallStatus = 'pending' | 'running' | 'complete' | 'failed' | 'rejected';

/** Where a tool URL came from. History never upgrades a URL to a trusted source. */
export type AiToolProvenance = 'userProvided' | 'searchDerived' | 'modelProposed';

/** Carries both the call and its result, so one assistant message stays one round. */
export interface AiToolCall {
  id: string;
  name: string;
  /** Raw argument JSON exactly as the provider sent it. */
  arguments: string;
  status: AiToolCallStatus;
  result?: string;
  error?: string;
  provenance?: AiToolProvenance;
  /** Byte-exact URL shown for verification; never rewritten or cached as approved. */
  url?: string;
  durationMs?: number;
}

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
  toolCalls?: AiToolCall[];
}

export type AiAnswerVersion = Pick<AiMessage, 'content' | 'thinking' | 'createdAt' | 'status' | 'modelId' | 'providerId' | 'error' | 'usage' | 'finishReason' | 'firstTokenMs' | 'durationMs' | 'toolCalls'>;

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

export interface AiSearchService { baseUrl: string; hasApiKey: boolean; enabled: boolean }

export interface AiMediaService { baseUrl: string; hasApiKey: boolean; enabled: boolean; imageModel?: string; videoModel?: string }

export interface AiMcpServer { id: string; name: string; command: string; args: string[]; enabled: boolean }

export interface AiWorkspace {
  version: 1;
  providers: AiProvider[];
  assistants: AiAssistant[];
  conversations: AiConversation[];
  activeAssistantId: string;
  activeConversationId?: string;
  templates?: AiPromptTemplate[];
  searchService?: AiSearchService;
  mediaService?: AiMediaService;
  mcpServers?: AiMcpServer[];
}

export interface AiPromptTemplate { id: string; name: string; content: string; favorite?: boolean }

/** No "always allow" variant: every call is re-approved and re-checked. */
export type AiToolDecision = 'approved' | 'rejected';

/** Read-only view of the Rust registry; the frontend never owns definitions. */
export interface AiToolInfo {
  name: string;
  description: string;
  parameters: unknown;
  approval: 'auto' | 'approve';
  readOnly: boolean;
  openWorld: boolean;
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
  type: 'delta' | 'thinking' | 'done' | 'error' | 'stopped' | 'metadata' | 'tool_call' | 'tool_result' | 'approval_required' | 'question_required';
  text?: string;
  error?: string;
  finishReason?: string;
  usage?: AiUsage;
  callId?: string;
  name?: string;
  arguments?: string;
  status?: AiToolCallStatus;
  result?: string;
  provenance?: AiToolProvenance;
  url?: string;
  filePath?: string;
  fileSize?: number;
  durationMs?: number;
  forcedFinish?: boolean;
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
  listTools(): Promise<AiToolInfo[]>;
  decideTool(callId: string, decision: AiToolDecision): Promise<void>;
  answerTool(callId: string, answer: string): Promise<void>;
  saveSearchService(config: AiSearchService, apiKey?: string): Promise<AiSearchService>;
  saveMediaService(config: AiMediaService, apiKey?: string): Promise<AiMediaService>;
  saveMcpServers(servers: AiMcpServer[]): Promise<AiMcpServer[]>;
  testSearchService(): Promise<string>;
  testConnection(providerId: string): Promise<string>;
  testModel?(providerId: string, modelId: string): Promise<string>;
  generate(request: AiRequest, onEvent: (event: AiStreamEvent) => void): Promise<void>;
  cancel(requestId: string): Promise<void>;
  openDataDirectory(): Promise<void>;
  reset(): Promise<void>;
}
