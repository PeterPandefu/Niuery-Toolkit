import { useId, useMemo, useState } from 'react';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { BotMessageSquare, Copy, Pencil, RefreshCw, User } from 'lucide-react';
import { toast } from 'sonner';
import type { AiAttachment, AiMessage } from './types';
import { iconLabel, useAiText } from './ui-text';

export function AttachmentPreview({ attachment, onRemove }: { attachment: AiAttachment; onRemove?: () => void }) {
  const t = useAiText();
  return <div className="ai-attachment">
    {attachment.kind === 'image' ? <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt={attachment.name} /> : null}
    <div className="ai-attachment-name"><span title={attachment.name}>{attachment.name}</span><small>{(attachment.size / 1024).toFixed(1)} KiB</small></div>
    {attachment.kind === 'text' && <details><summary>{t('预览文本', 'Preview text')}</summary><pre>{attachment.data}</pre></details>}
    {onRemove && <button type="button" {...iconLabel(`${t('移除附件', 'Remove attachment')}: ${attachment.name}`)} onClick={onRemove}>×</button>}
  </div>;
}

function ThinkingPanel({ text, streaming, thinking }: { text: string; streaming: boolean; thinking: boolean }) {
  const t = useAiText();
  const [open, setOpen] = useState(streaming);
  const id = useId();
  return <section className={`ai-thinking ${open ? 'is-open' : ''}`} aria-label={t('思考', 'Thinking')}>
    <button type="button" className="ai-thinking-toggle" aria-label={open ? t('隐藏思考', 'Hide thinking') : t('显示思考', 'Show thinking')} aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>{open ? t('隐藏思考', 'Hide thinking') : t('显示思考', 'Show thinking')}{thinking && <span className="ai-thinking-status"> · {t('模型思考中…', 'Thinking…')}</span>}</button>
    <div id={id} className="ai-thinking-content" hidden={!open}>{text}</div>
  </section>;
}

export function MessageView({ message, disabled, lastAssistant, onEdit, onRegenerate, onQuote, onFork, onVersion, showThinking = true }: { message: AiMessage; disabled: boolean; lastAssistant: boolean; onEdit(message: AiMessage): void; onRegenerate(): void; onQuote?(text: string): void; onFork?(message: AiMessage): void; onVersion?(index: number): void; showThinking?: boolean }) {
  const t = useAiText();
  const [copied, setCopied] = useState(false);
  const copyCodeLabel = t('复制代码', 'Copy code');
  const blockedImage = t('远程图片未自动加载', 'Remote image not loaded');
  const rendered = useMemo(() => {
    const blocks: string[] = [];
    const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
    md.renderer.rules.image = (tokens, index) => `<span class="ai-blocked-image">[${md.utils.escapeHtml(tokens[index].content || blockedImage)} · ${md.utils.escapeHtml(blockedImage)}]</span>`;
    md.renderer.rules.fence = (tokens, index) => {
      const token = tokens[index];
      const language = token.info.trim().split(/\s+/)[0];
      const highlighted = language && hljs.getLanguage(language) ? hljs.highlight(token.content, { language, ignoreIllegals: true }).value : md.utils.escapeHtml(token.content);
      const block = blocks.push(token.content) - 1;
      return `<div class="ai-code-block"><div class="ai-code-header"><span>${md.utils.escapeHtml(language || 'text')}</span><button type="button" data-ai-code="${block}" aria-label="${copyCodeLabel}">${copyCodeLabel}</button></div><pre><code class="hljs">${highlighted}</code></pre></div>`;
    };
    const originalLink = md.renderer.rules.link_open;
    md.renderer.rules.link_open = (tokens, index, options, env, self) => {
      tokens[index].attrSet('target', '_blank'); tokens[index].attrSet('rel', 'noopener noreferrer');
      return originalLink ? originalLink(tokens, index, options, env, self) : self.renderToken(tokens, index, options);
    };
    return { html: md.render(message.content), blocks };
  }, [message.content, copyCodeLabel, blockedImage]);
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(true); toast.success(t('已复制', 'Copied')); return true; }
    catch { toast.error(t('复制失败，请检查剪贴板权限', 'Could not copy. Check clipboard permissions.')); return false; }
  }
  const status = { waiting: t('等待回复…', 'Waiting for response…'), streaming: t('正在生成…', 'Generating…'), complete: '', stopped: t('已停止', 'Stopped'), failed: t('生成失败', 'Failed'), interrupted: t('回复意外中断', 'Interrupted') }[message.status];
  return <article data-ai-message={message.id} className={`ai-message ai-message-${message.role}`} aria-label={t(message.role === 'user' ? '用户消息' : '助手消息', message.role === 'user' ? 'User message' : 'Assistant message')}>
    <div className="ai-message-avatar">{message.role === 'user' ? <User size={17} /> : <BotMessageSquare size={18} />}</div>
    <div className="ai-message-body">
      <div className="ai-message-meta"><strong>{message.role === 'user' ? t('你', 'You') : t('助手', 'Assistant')}</strong>{message.modelId && <span>{message.modelId}</span>}<time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
      {message.role === 'assistant' && showThinking && !!message.thinking && <ThinkingPanel key={`${message.id}:${message.createdAt}:${message.selectedVersion ?? ''}:${message.status === 'streaming' ? 'active' : 'settled'}`} text={message.thinking} streaming={message.status === 'streaming'} thinking={message.status === 'streaming' && !message.content} />}
      <div className="ai-markdown ai-answer" dangerouslySetInnerHTML={{ __html: rendered.html }} onClick={event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ai-code]');
        if (button) void copy(rendered.blocks[Number(button.dataset.aiCode)]).then(success => { if (success) button.textContent = t('已复制', 'Copied'); });
      }} />
      {!!message.attachments.length && <div className="ai-attachments">{message.attachments.map(attachment => <AttachmentPreview key={attachment.id} attachment={attachment} />)}</div>}
      {status && <p className={`ai-message-status ${message.status === 'failed' ? 'ai-error-text' : ''}`} role="status">{status}</p>}
      {message.error && <p role="alert" className="ai-error-text">{message.error}</p>}
      {message.status === 'complete' && message.finishReason === 'length' && <p role="status" className="ai-error-text">{t('已达到输出上限，回答可能不完整。可提高输出上限后重新生成。', 'Output limit reached. The answer may be incomplete. Increase the limit and regenerate.')}</p>}
      {message.status === 'complete' && message.finishReason === 'content_filter' && <p role="status">{t('回复因服务内容过滤而结束。', 'The service ended this reply due to content filtering.')}</p>}
      {message.usage && <p className="ai-muted">{t('实际用量', 'Actual usage')}: {message.usage.inputTokens} / {message.usage.outputTokens} / {message.usage.totalTokens} tokens {t('（输入／输出／总计）', '(input / output / total)')}</p>}
      {message.durationMs !== undefined && <p className="ai-muted">{t('首字／总耗时', 'First token / duration')}: {message.firstTokenMs === undefined ? '—' : (message.firstTokenMs / 1000).toFixed(2)} / {(message.durationMs / 1000).toFixed(2)} s</p>}
      <div className="ai-message-actions"><button type="button" {...iconLabel(copied ? t('已复制', 'Copied') : t('复制消息', 'Copy message'))} onClick={() => void copy(message.content)}><Copy size={13} /><span>{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}</span></button>
        {onFork && <button type="button" disabled={disabled} aria-label={t('从此处分叉', 'Fork from here')} onClick={() => onFork(message)}>{t('分叉', 'Fork')}</button>}
        {message.versions && message.versions.length > 1 && onVersion && <label>{t('回复版本', 'Answer version')}<select disabled={disabled} aria-label={t('回复版本', 'Answer version')} value={message.selectedVersion ?? message.versions.length - 1} onChange={event => onVersion(Number(event.target.value))}>{message.versions.map((version, index) => <option key={index} value={index}>{index + 1}/{message.versions!.length} · {version.modelId ?? ''}</option>)}</select></label>}
        {onQuote && message.role === 'assistant' && <button type="button" aria-label={t('引用消息', 'Quote message')} onMouseDown={event => event.preventDefault()} onClick={event => { const selection = window.getSelection(); const answer = event.currentTarget.closest('article')?.querySelector('.ai-markdown'); const text = selection && selection.rangeCount && answer?.contains(selection.anchorNode) && answer.contains(selection.focusNode) ? selection.toString().trim() : ''; onQuote(text || message.content); }}>{t('引用提问', 'Quote')}</button>}
        {message.role === 'user' && <button type="button" disabled={disabled} {...iconLabel(t('编辑消息', 'Edit message'))} onClick={() => onEdit(message)}><Pencil size={13} /><span>{t('编辑', 'Edit')}</span></button>}
        {lastAssistant && <button type="button" disabled={disabled} onClick={onRegenerate} {...iconLabel(t('重新生成', 'Regenerate'))}><RefreshCw size={13} /><span>{t('重新生成', 'Regenerate')}</span></button>}
      </div>
    </div>
  </article>;
}
