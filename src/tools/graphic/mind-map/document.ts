import type { MindMapData, MindMapNode } from 'simple-mind-map';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';

export type MindMapDocument = MindMapData;

export function createMindMapDocument(title = '未命名思维导图'): MindMapDocument {
  return {
    root: {
      data: { text: title },
      children: [],
    },
    layout: 'logicalStructure',
    theme: { template: 'default', config: {} },
  };
}

function isNode(value: unknown): value is MindMapNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as Partial<MindMapNode>;
  return Boolean(
    node.data
      && typeof node.data === 'object'
      && typeof (node.data as Record<string, unknown>).text === 'string'
      && Array.isArray(node.children)
      && node.children.every(isNode),
  );
}

function hasOnlyEmbeddedImages(node: MindMapNode): boolean {
  const image = node.data.image;
  return (typeof image !== 'string' || image.startsWith('data:'))
    && node.children.every(hasOnlyEmbeddedImages);
}

/** 只接受 simple-mind-map 的完整 JSON，避免静默吞掉未知格式。 */
export function parseMindMapDocument(source: string): MindMapDocument {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!value || typeof value !== 'object' || !isNode((value as { root?: unknown }).root)) {
    throw new Error('文件不是兼容的思维导图 JSON');
  }
  const document = value as MindMapDocument;
  if (!hasOnlyEmbeddedImages(document.root)) {
    throw new Error('思维导图只允许使用嵌入式图片，不能加载远程图片');
  }
  return document;
}

function xmindText(value: unknown) {
  if (typeof value === 'string') return value.trim() || '未命名主题';
  if (value && typeof value === 'object') {
    const record = value as { text?: unknown; plainText?: unknown; '#text'?: unknown };
    const text = record.text ?? record.plainText ?? record['#text'];
    if (typeof text === 'string') return text.trim() || '未命名主题';
  }
  return '未命名主题';
}

function xmindJsonNode(value: unknown, isRoot = false): MindMapNode {
  const topic = (value && typeof value === 'object' ? value : {}) as {
    title?: unknown;
    children?: { attached?: unknown };
  };
  const attached = Array.isArray(topic.children?.attached) ? topic.children.attached : [];
  return {
    data: { text: xmindText(topic.title), expand: isRoot },
    children: attached.map((child) => xmindJsonNode(child)),
  };
}

function xmindXmlNode(value: unknown, isRoot = false): MindMapNode {
  const topic = (value && typeof value === 'object' ? value : {}) as {
    title?: unknown;
    children?: { topics?: unknown };
  };
  const topics = topic.children?.topics;
  const containers = Array.isArray(topics) ? topics : topics ? [topics] : [];
  const children = containers.flatMap((container) => {
    if (!container || typeof container !== 'object') return [];
    const topicValue = (container as { topic?: unknown }).topic;
    if (topicValue === undefined) return 'title' in container ? [container] : [];
    return Array.isArray(topicValue) ? topicValue : [topicValue];
  });
  return {
    data: { text: xmindText(topic.title), expand: isRoot },
    children: children.map((child) => xmindXmlNode(child)),
  };
}

/** 从 XMind ZIP（content.json 或旧版 content.xml）导入可编辑导图。 */
export async function parseXMindDocument(source: ArrayBuffer | Uint8Array): Promise<MindMapDocument> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(source);
  } catch {
    throw new Error('文件不是有效的 XMind 文档');
  }

  const jsonEntry = zip.file('content.json');
  if (jsonEntry) {
    let content: unknown;
    try {
      content = JSON.parse(await jsonEntry.async('text'));
    } catch {
      throw new Error('XMind 的 content.json 无法解析');
    }
    const record = (content && typeof content === 'object' ? content : {}) as {
      sheets?: unknown;
      rootTopic?: unknown;
    };
    const sheets = Array.isArray(content)
      ? content
      : Array.isArray(record.sheets)
        ? record.sheets
        : record.rootTopic
          ? [record]
          : [];
    const sheet = sheets[0] as { rootTopic?: unknown } | undefined;
    if (!sheet?.rootTopic) throw new Error('XMind 的 content.json 中没有可识别的根主题');
    const root = xmindJsonNode(sheet.rootTopic, true);
    return { root, layout: 'logicalStructure', theme: { template: 'default', config: {} } };
  }

  const xmlEntry = zip.file('content.xml');
  if (xmlEntry) {
    try {
      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
      const content = parser.parse(await xmlEntry.async('text')) as {
        'xmap-content'?: { sheet?: { topic?: unknown } | Array<{ topic?: unknown }> };
      };
      const sheets = content['xmap-content']?.sheet;
      const sheet = Array.isArray(sheets) ? sheets[0] : sheets;
      if (sheet?.topic) {
        return { root: xmindXmlNode(sheet.topic, true), layout: 'logicalStructure', theme: { template: 'default', config: {} } };
      }
    } catch {
      throw new Error('XMind 的 content.xml 无法解析');
    }
  }

  throw new Error('XMind 文档中没有可识别的主题数据');
}

function appendNote(node: MindMapNode, line: string) {
  const note = typeof node.data.note === 'string' ? node.data.note : '';
  node.data.note = note ? `${note}\n${line}` : line;
}

function createNode(text: string): MindMapNode {
  return { data: { text }, children: [] };
}

/**
 * 将首个一级标题作为根节点，并将标题与嵌套列表映射为分支。
 * 其余 Markdown 内容保留为当前节点的纯文本备注，不尝试重建复杂排版。
 */
export function markdownToMindMap(markdown: string): MindMapDocument {
  const document = createMindMapDocument();
  const root = document.root;
  const headingStack: MindMapNode[] = [root];
  let listStack: MindMapNode[] = [];
  let foundRootHeading = false;
  let current = root;

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const noteLine = rawLine.match(/^\s*>\s?(.*)$/);
    if (noteLine) {
      appendNote(listStack[listStack.length - 1] ?? current, noteLine[1]);
      continue;
    }
    const heading = rawLine.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2];
      listStack = [];
      if (level === 1 && !foundRootHeading) {
        root.data.text = text;
        foundRootHeading = true;
        headingStack.length = 1;
        current = root;
        continue;
      }
      const depth = Math.max(1, level - (foundRootHeading ? 1 : 0));
      headingStack.length = Math.min(headingStack.length, depth);
      const parent = headingStack[depth - 1] ?? root;
      const node = createNode(text);
      parent.children.push(node);
      headingStack[depth] = node;
      headingStack.length = depth + 1;
      current = node;
      continue;
    }

    const listItem = rawLine.match(/^(\s*)[-*+]\s+(.+?)\s*$/) ?? rawLine.match(/^(\s*)\d+[.)]\s+(.+?)\s*$/);
    if (listItem) {
      const depth = Math.floor(listItem[1].replace(/\t/g, '  ').length / 2);
      const parent = depth === 0 ? current : (listStack[depth - 1] ?? current);
      const node = createNode(listItem[2]);
      parent.children.push(node);
      listStack[depth] = node;
      listStack.length = depth + 1;
      continue;
    }

    if (rawLine.trim()) appendNote(listStack[listStack.length - 1] ?? current, rawLine.trim());
  }

  return document;
}

function markdownText(value: unknown) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim() || '未命名主题';
}

function appendMarkdownNote(lines: string[], note: unknown, indent: string) {
  if (typeof note !== 'string' || !note.trim()) return;
  for (const line of note.replace(/\r\n/g, '\n').split('\n')) {
    lines.push(`${indent}> ${line}`);
  }
}

/**
 * 导出为可读的 Markdown：主主题为一级标题，子主题为缩进列表，备注为引用块。
 * 图形布局、主题及折叠状态属于 .json 文档专有信息，不写入 Markdown。
 */
export function mindMapToMarkdown(document: MindMapDocument): string {
  const lines = [`# ${markdownText(document.root.data.text)}`];
  appendMarkdownNote(lines, document.root.data.note, '');

  const appendChildren = (nodes: MindMapNode[], depth: number) => {
    for (const node of nodes) {
      const indent = '  '.repeat(depth);
      lines.push(`${indent}- ${markdownText(node.data.text)}`);
      appendMarkdownNote(lines, node.data.note, `${indent}  `);
      appendChildren(node.children, depth + 1);
    }
  };

  appendChildren(document.root.children, 0);
  return `${lines.join('\n')}\n`;
}
