export interface CanvasImage {
  source: string;
  mimeType: string;
}

export interface CanvasNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  note: string;
  tags: string[];
  color: string;
  filePath?: string;
  image?: CanvasImage;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  directed: boolean;
}

export interface KnowledgeCanvasDocument {
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export interface CanvasAsset {
  filename: string;
  base64: string;
}

function isChineseLocale(locale: string) {
  return locale.toLowerCase().startsWith('zh');
}

export function createKnowledgeCanvas(locale = 'zh-CN'): KnowledgeCanvasDocument {
  const chinese = isChineseLocale(locale);
  return {
    version: 1,
    nodes: [
      {
        id: 'start',
        x: 120,
        y: 120,
        width: 220,
        height: 128,
        text: chinese ? '从这里开始' : 'Start here',
        note: chinese ? '双击卡片编辑内容，拖拽移动位置。' : 'Double-click a card to edit it, then drag it to reposition.',
        tags: [chinese ? '起点' : 'Start'],
        color: '#d97706',
      },
      {
        id: 'idea',
        x: 470,
        y: 280,
        width: 220,
        height: 128,
        text: chinese ? '关联想法' : 'Related idea',
        note: chinese ? '选择“连线”后依次点击两张卡片。' : 'Select Connect, then click the two cards in order.',
        tags: [],
        color: '#0f766e',
      },
    ],
    edges: [{ id: 'start-idea', from: 'start', to: 'idea', directed: true }],
  };
}

export function createKnowledgeCanvasTemplate(template: 'problem' | 'research', locale = 'zh-CN'): KnowledgeCanvasDocument {
  const chinese = isChineseLocale(locale);
  if (template === 'problem') {
    return {
      version: 1,
      nodes: [
        { id: 'symptom', x: 110, y: 180, width: 220, height: 128, text: chinese ? '症状' : 'Symptom', note: chinese ? '观察到什么？' : 'What did you observe?', tags: [chinese ? '现象' : 'Observation'], color: '#dc2626' },
        { id: 'cause', x: 440, y: 110, width: 220, height: 128, text: chinese ? '根因' : 'Root cause', note: chinese ? '为什么发生？' : 'Why did it happen?', tags: [chinese ? '分析' : 'Analysis'], color: '#d97706' },
        { id: 'action', x: 440, y: 320, width: 220, height: 128, text: chinese ? '下一步' : 'Next step', note: chinese ? '先验证哪一项？' : 'What should be verified first?', tags: [chinese ? '行动' : 'Action'], color: '#0f766e' },
      ],
      edges: [{ id: 'symptom-cause', from: 'symptom', to: 'cause', directed: true }, { id: 'cause-action', from: 'cause', to: 'action', directed: true }],
    };
  }
  return {
    version: 1,
    nodes: [
      { id: 'question', x: 110, y: 200, width: 220, height: 128, text: chinese ? '研究问题' : 'Research question', note: chinese ? '要回答什么？' : 'What needs answering?', tags: [chinese ? '问题' : 'Question'], color: '#2563eb' },
      { id: 'source', x: 430, y: 100, width: 220, height: 128, text: chinese ? '资料来源' : 'Sources', note: chinese ? '本地文件或摘录' : 'Local files or excerpts', tags: [chinese ? '证据' : 'Evidence'], color: '#7c3aed' },
      { id: 'conclusion', x: 430, y: 330, width: 220, height: 128, text: chinese ? '结论' : 'Conclusion', note: chinese ? '可以确认什么？' : 'What can be confirmed?', tags: [chinese ? '结论' : 'Conclusion'], color: '#0f766e' },
    ],
    edges: [{ id: 'question-source', from: 'question', to: 'source', directed: true }, { id: 'source-conclusion', from: 'source', to: 'conclusion', directed: true }],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isCanvasNode(value: unknown): value is CanvasNode {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.x === 'number'
    && typeof value.y === 'number'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
    && typeof value.text === 'string'
    && typeof value.note === 'string'
    && Array.isArray(value.tags)
    && value.tags.every((tag) => typeof tag === 'string')
    && typeof value.color === 'string'
    && (value.image === undefined || (isRecord(value.image)
      && typeof value.image.source === 'string'
      && typeof value.image.mimeType === 'string'));
}

function isCanvasEdge(value: unknown): value is CanvasEdge {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.from === 'string'
    && typeof value.to === 'string'
    && typeof value.directed === 'boolean';
}

/** 严格读取工具箱自己的画布文档，防止不完整数据进入编辑状态。 */
export function parseKnowledgeCanvas(source: string): KnowledgeCanvasDocument {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new Error('文件不是兼容的 .niuery-canvas 画布');
  }
  if (!value.nodes.every(isCanvasNode) || !value.edges.every(isCanvasEdge)) {
    throw new Error('画布包含无效的卡片或连线');
  }
  const ids = new Set(value.nodes.map((node) => node.id));
  if (ids.size !== value.nodes.length || value.edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to))) {
    throw new Error('画布连线引用了不存在的卡片');
  }
  return value as unknown as KnowledgeCanvasDocument;
}

function dataUrlParts(source: string) {
  const match = source.match(/^data:([^;]+);base64,(.+)$/);
  return match ? { mimeType: match[1], base64: match[2] } : null;
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/gif') return 'gif';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/svg+xml') return 'svg';
  return 'png';
}

/** 将内存中的 data URL 变成与文档同名的资源目录引用。 */
export function prepareCanvasSave(document: KnowledgeCanvasDocument): { content: string; assets: CanvasAsset[] } {
  const assets: CanvasAsset[] = [];
  const serializable: KnowledgeCanvasDocument = structuredClone(document);
  serializable.nodes.forEach((node) => {
    if (!node.image) return;
    const parts = dataUrlParts(node.image.source);
    if (!parts) return;
    const filename = `${node.id}.${extensionForMime(parts.mimeType)}`;
    node.image = { ...node.image, source: `__ASSET_DIR__/${filename}` };
    assets.push({ filename, base64: parts.base64 });
  });
  return { content: JSON.stringify(serializable, null, 2), assets };
}

export function knowledgeCanvasBounds(document: KnowledgeCanvasDocument) {
  const nodes = document.nodes;
  const minX = Math.min(0, ...nodes.map((node) => node.x - 24));
  const minY = Math.min(0, ...nodes.map((node) => node.y - 24));
  const maxX = Math.max(800, ...nodes.map((node) => node.x + node.width + 24));
  const maxY = Math.max(600, ...nodes.map((node) => node.y + node.height + 24));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
}

/** 导出不依赖运行时 DOM 的可移植 SVG。 */
export function knowledgeCanvasToSvg(document: KnowledgeCanvasDocument): string {
  const nodes = document.nodes;
  const bounds = knowledgeCanvasBounds(document);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const lines = document.edges.flatMap((edge) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return [];
    return [`<line x1="${from.x + from.width / 2}" y1="${from.y + from.height / 2}" x2="${to.x + to.width / 2}" y2="${to.y + to.height / 2}" stroke="#64748b" stroke-width="2" marker-end="${edge.directed ? 'url(#arrow)' : ''}" />`];
  }).join('');
  const cards = nodes.map((node) => {
    const note = node.note ? `<text x="${node.x + 16}" y="${node.y + 56}" fill="#475569" font-size="12">${escapeXml(node.note.slice(0, 80))}</text>` : '';
    const image = node.image ? `<image href="${escapeXml(node.image.source)}" x="${node.x + 12}" y="${node.y + 48}" width="${node.width - 24}" height="${node.height - 60}" preserveAspectRatio="none" opacity="0.9" />` : '';
    return `<g><rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="12" fill="#ffffff" stroke="${node.color}" stroke-width="3" /><rect x="${node.x}" y="${node.y}" width="7" height="${node.height}" rx="3" fill="${node.color}" /><text x="${node.x + 16}" y="${node.y + 32}" fill="#0f172a" font-family="sans-serif" font-size="16" font-weight="600">${escapeXml(node.text)}</text>${image}${note}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" /></marker></defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#f8fafc" />${lines}${cards}</svg>`;
}
