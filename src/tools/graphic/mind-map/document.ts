import type { MindMapData, MindMapNode } from 'simple-mind-map';

export type MindMapDocument = MindMapData;

export function createMindMapDocument(title = '未命名思维导图'): MindMapDocument {
  return {
    root: {
      data: { text: title },
      children: [],
    },
    layout: 'logicalStructure',
    theme: { template: 'classic4', config: {} },
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
    throw new Error('文件不是兼容的 .smm 思维导图');
  }
  const document = value as MindMapDocument;
  if (!hasOnlyEmbeddedImages(document.root)) {
    throw new Error('思维导图只允许使用嵌入式图片，不能加载远程图片');
  }
  return document;
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
