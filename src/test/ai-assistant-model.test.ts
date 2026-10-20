import { describe, expect, it } from 'vitest';
import { buildContext, createWorkspace, exportConversation, newConversation, providerTarget } from '@/tools/ai-assistant/model';
import { readAttachment, validateAttachments } from '@/tools/ai-assistant/attachments';
import type { AiAttachment, AiMessage } from '@/tools/ai-assistant/types';

const message = (role: AiMessage['role'], content: string, status: AiMessage['status'] = 'complete'): AiMessage => ({
  id: content, role, content, status, attachments: [], createdAt: 1,
});
const conversation = () => newConversation(createWorkspace().assistants[0]);

describe('AI conversation domain', () => {
  it('creates independent assistant snapshots and three editable presets', () => {
    const workspace = createWorkspace();
    expect(workspace.assistants.map(a => a.name)).toEqual(['通用助手', '编程助手', '翻译助手']);
    const chat = newConversation(workspace.assistants[0]);
    workspace.assistants[0].parameters.historyRounds = 3;
    expect(chat.parameters.historyRounds).toBe(20);
    expect(chat.messages).toEqual([]);
    expect(chat.systemPrompt).toBeTruthy();
  });

  it('sends only complete historical rounds and the pending user message', () => {
    const chat = conversation();
    chat.messages = [message('user', 'old'), message('assistant', 'valid'), message('user', 'failed question'),
      message('assistant', 'partial', 'failed'), message('user', 'current'), message('assistant', '', 'waiting')];
    expect(buildContext(chat).map(m => m.content)).toEqual(['old', 'valid', 'current']);
  });

  it('keeps the last 20 rounds and preserves full local history', () => {
    const chat = conversation();
    chat.messages = Array.from({ length: 23 }, (_, i) => [message('user', `q${i}`), message('assistant', `a${i}`)]).flat();
    chat.messages.push(message('user', 'now'));
    expect(buildContext(chat)).toHaveLength(41);
    expect(buildContext(chat)[0].content).toBe('q3');
    expect(chat.messages).toHaveLength(47);
  });

  it('zero history rounds sends only the current user including attachments', () => {
    const chat = conversation();
    chat.parameters.historyRounds = 0;
    chat.messages = [message('user', 'old'), message('assistant', 'answer'), message('user', 'now')];
    expect(buildContext(chat).map(m => m.content)).toEqual(['now']);
  });

  it('exports archive content without unknown credential fields', () => {
    const chat = { ...conversation(), apiKey: 'secret', title: 'Test archive' };
    chat.messages = [message('user', 'hello'), { ...message('assistant', 'world'), modelId: 'm1' }];
    expect(exportConversation(chat, 'json')).not.toContain('secret');
    const archive = JSON.parse(exportConversation(chat, 'json'));
    expect(archive.messages[1].content).toBe('world');
    expect(exportConversation(chat, 'markdown')).toContain('## 助手');
  });
  it('exports summary and model comparison results to Markdown and excludes unknown credentials from JSON', () => {
    const chat = { ...conversation(), summary: 'Use SQLite', tasks: [{ id: 'task', kind: 'comparison' as const, prompt: 'Choose a database', createdAt: 1, results: [{ label: 'Model A', target: 'p:http://localhost', message: { ...message('assistant', 'SQLite is suitable'), apiKey: 'secret' } }] }] };
    const markdown = exportConversation(chat, 'markdown');
    expect(markdown).toContain('Use SQLite'); expect(markdown).toContain('Model A'); expect(markdown).toContain('SQLite is suitable');
    expect(exportConversation(chat, 'json')).not.toContain('secret');
  });
  it('exports model thinking separately from the final answer', () => {
    const chat = conversation();
    chat.messages = [{ ...message('assistant', 'Final answer'), thinking: 'Private reasoning returned by the model' }];
    expect(exportConversation(chat, 'json')).toContain('Private reasoning returned by the model');
    expect(exportConversation(chat, 'markdown')).toContain('思考过程');
  });
  it('exports thinking for comparison results without allowing raw HTML to escape the fold', () => {
    const chat = conversation();
    chat.tasks = [{ id: 't', kind: 'comparison', prompt: 'Question', createdAt: 1, results: [{ label: 'Model', target: 'local', message: { ...message('assistant', 'Answer'), thinking: '</details><script>bad()</script>\n\nThought' } }] }];
    const exported = exportConversation(chat, 'markdown');
    expect(exported).toContain('思考过程');
    expect(exported).not.toContain('</details><script>bad()</script>');
    expect(exported).toContain('&lt;/details&gt;');
    expect(JSON.parse(exportConversation(chat, 'json')).tasks[0].results[0].message.thinking).toContain('Thought');
  });

  it('provider target includes the configured address and normalizes trailing slashes', () => {
    expect(providerTarget({ id: 'p1', baseUrl: ' https://example.com/v1/// ' })).toBe('p1:https://example.com/v1');
  });
});

describe('AI attachment validation', () => {
  const text: AiAttachment = { id: 't', name: 'file.txt', kind: 'text', mimeType: 'text/plain', size: 10, data: 'hello' };
  const image: AiAttachment = { id: 'i', name: 'image.png', kind: 'image', mimeType: 'image/png', size: 10, data: 'aGVsbG8=' };

  it('reads UTF-8 text and rejects binary or unsupported files', async () => {
    const attachment = await readAttachment(new File(['你好'], 'code.ts', { type: 'text/plain' }));
    expect(attachment.data).toBe('你好');
    expect(attachment.kind).toBe('text');
    await expect(readAttachment(new File([new Uint8Array([0xff, 0xfe])], 'bad.txt'))).rejects.toThrow(/UTF-8/);
    await expect(readAttachment(new File(['pdf'], 'file.pdf', { type: 'application/pdf' }))).rejects.toThrow(/无效|Invalid/);
    await expect(readAttachment(new File(['word'], 'file.docx'))).rejects.toThrow(/格式|支持/);
    await expect(readAttachment(new File([new Uint8Array([0, 1, 2])], 'binary.txt'))).rejects.toThrow(/二进制/);
  });

  it('enforces per-message image, text and aggregate character limits', () => {
    expect(() => validateAttachments(Array(5).fill(image))).toThrow(/4/);
    expect(() => validateAttachments(Array(6).fill(text))).toThrow(/5/);
    expect(() => validateAttachments([{ ...image, size: 10 * 1024 * 1024 + 1 }])).toThrow(/10/);
    expect(() => validateAttachments([{ ...text, data: 'a'.repeat(200_001) }])).toThrow(/200/);
    expect(() => validateAttachments([{ ...image, mimeType: 'image/svg+xml' }])).toThrow(/支持|格式/);
  });
});
