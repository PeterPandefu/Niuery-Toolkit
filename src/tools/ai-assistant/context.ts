import { buildContext } from './model';
import type { AiConversation, AiMessage, AiModel, AiParameters } from './types';

/** Conservative heuristic, never presented as provider-measured usage. */
export function estimateTokens(text: string): number {
  let weight = 0;
  for (const character of text) weight += character.codePointAt(0)! > 127 ? 1 : 0.25;
  return Math.ceil(weight);
}

function messageTokens(message: AiMessage): number {
  return 8 + estimateTokens(message.content) + message.attachments.reduce((sum, file) => sum + (file.kind === 'image' ? 2048 : 16 + estimateTokens(file.name) + estimateTokens(file.data)), 0);
}

export function effectiveParameters(parameters: AiParameters, model?: AiModel): AiParameters {
  if ([model?.contextWindow, model?.maxOutputTokens].some(value => value !== undefined && (!Number.isSafeInteger(value) || value <= 0))) throw new Error('模型容量必须为正整数。 / Invalid model capacity.');
  const next = { ...parameters };
  if (model?.supportsTemperature === false) delete next.temperature;
  if (model?.maxOutputTokens) next.maxOutputTokens = Math.min(next.maxOutputTokens ?? model.maxOutputTokens, model.maxOutputTokens);
  return next;
}

export function buildBudgetedContext(conversation: AiConversation, model?: AiModel) {
  const source = buildContext(conversation);
  const excluded = new Set(conversation.excludedMessageIds ?? []);
  const messages: AiMessage[] = [];
  for (let index = 0; index < source.length - 1; index += 2) {
    if (!excluded.has(source[index].id) && !excluded.has(source[index + 1].id)) messages.push(source[index], source[index + 1]);
  }
  if (source.length) messages.push(source[source.length - 1]);
  const parameters = effectiveParameters(conversation.parameters, model);
  const contextWindow = model?.contextWindow;
  const reservedOutputTokens = parameters.maxOutputTokens ?? Math.min(4096, contextWindow ? Math.max(1, Math.floor(contextWindow / 4)) : 4096);
  if (contextWindow && parameters.maxOutputTokens === undefined) parameters.maxOutputTokens = reservedOutputTokens;
  const systemPrompt = `${conversation.systemPrompt}${conversation.summary ? `\n\n<conversation_summary>\n${conversation.summary}\n</conversation_summary>` : ''}`;
  const systemTokens = 8 + estimateTokens(systemPrompt);
  let inputTokens = systemTokens + messages.reduce((sum, message) => sum + messageTokens(message), 0);
  let droppedRounds = 0;
  while (contextWindow && inputTokens + reservedOutputTokens > contextWindow && messages.length > 1) {
    inputTokens -= messageTokens(messages.shift()!) + messageTokens(messages.shift()!);
    droppedRounds++;
  }
  if (contextWindow && inputTokens + reservedOutputTokens > contextWindow) throw new Error('当前消息、系统提示词及输出预留超过模型上下文容量，请减少内容或附件。 / Input exceeds the model context budget.');
  return { messages, inputTokens, reservedOutputTokens, contextWindow, droppedRounds, parameters, systemPrompt };
}
