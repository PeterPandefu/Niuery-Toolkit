import { useMemo, useState } from 'react';
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

export function MessageView({ message, disabled, lastAssistant, onEdit, onRegenerate }: { message: AiMessage; disabled: boolean; lastAssistant: boolean; onEdit(message: AiMessage): void; onRegenerate(): void }) {
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
  return <article className={`ai-message ai-message-${message.role}`} aria-label={t(message.role === 'user' ? '用户消息' : '助手消息', message.role === 'user' ? 'User message' : 'Assistant message')}>
    <div className="ai-message-avatar">{message.role === 'user' ? <User size={17} /> : <BotMessageSquare size={18} />}</div>
    <div className="ai-message-body">
      <div className="ai-message-meta"><strong>{message.role === 'user' ? t('你', 'You') : t('助手', 'Assistant')}</strong>{message.modelId && <span>{message.modelId}</span>}<time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
      <div className="ai-markdown" dangerouslySetInnerHTML={{ __html: rendered.html }} onClick={event => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-ai-code]');
        if (button) void copy(rendered.blocks[Number(button.dataset.aiCode)]).then(success => { if (success) button.textContent = t('已复制', 'Copied'); });
      }} />
      {!!message.attachments.length && <div className="ai-attachments">{message.attachments.map(attachment => <AttachmentPreview key={attachment.id} attachment={attachment} />)}</div>}
      {status && <p className={`ai-message-status ${message.status === 'failed' ? 'ai-error-text' : ''}`} role="status">{status}</p>}
      {message.error && <p role="alert" className="ai-error-text">{message.error}</p>}
      <div className="ai-message-actions"><button type="button" {...iconLabel(copied ? t('已复制', 'Copied') : t('复制消息', 'Copy message'))} onClick={() => void copy(message.content)}><Copy size={13} /><span>{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}</span></button>
        {message.role === 'user' && <button type="button" disabled={disabled} {...iconLabel(t('编辑消息', 'Edit message'))} onClick={() => onEdit(message)}><Pencil size={13} /><span>{t('编辑', 'Edit')}</span></button>}
        {lastAssistant && <button type="button" disabled={disabled} onClick={onRegenerate} {...iconLabel(t('重新生成', 'Regenerate'))}><RefreshCw size={13} /><span>{t('重新生成', 'Regenerate')}</span></button>}
      </div>
    </div>
  </article>;
}
