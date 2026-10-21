import { createNode } from './document';
import type { FlowDocument, FlowEdge, FlowNode } from './types';

export const FLOW_AI_PROMPT = `你是流程图结构化生成器。只输出合法 JSON，不要 Markdown 代码围栏，不要解释文字。
输出格式：{"schemaVersion":2,"pages":[{"id":"page-1","name":"第 1 页","nodes":[{"id":"唯一ID","type":"terminator|process|decision|io|document|database|predefined|connector|note","position":{"x":0,"y":0},"data":{"label":"节点文本","semanticType":"terminator|process|decision|io|document|database|predefined|connector|note","shape":"rounded|rectangle|diamond|parallelogram|circle|text","fill":"#f5f7fb","stroke":"#526173","textColor":"#172033","width":150,"height":72}}],"edges":[{"id":"唯一边ID","source":"节点ID","target":"节点ID","type":"flow-edge","data":{"routing":"orthogonal","endMarker":"closed-arrow","label":"可选条件"}}],"viewport":{"x":0,"y":0,"zoom":1},"layers":[{"id":"layer-default","name":"默认图层","visible":true,"locked":false}]}],"activePageId":"page-1","nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}。
要求：节点 ID 和边 ID 不重复；source/target 必须引用存在的节点；先按从左到右的流程分配 position；判断节点使用 diamond；开始/结束使用 terminator；不要生成远程图片或外部资源。`;

function edgeId(source: string, target: string, index: number) { return `edge-${source}-${target}-${index}`; }

export function parseMermaidFlowchart(source: string): FlowDocument {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const ensureNode = (id: string, label?: string, kind?: 'decision' | 'terminator') => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const node = createNode(kind === 'decision' ? 'decision' : kind === 'terminator' ? 'terminator' : 'process', 120 + nodes.size * 220, 120 + (nodes.size % 3) * 120, label ?? id);
    node.id = id;
    nodes.set(id, node);
    return node;
  };
  let index = 0;
  for (const line of source.split(/\r?\n/)) {
    if (/^\s*(flowchart|graph)\b/i.test(line)) continue;
    const connection = line.match(/^\s*([\w-]+)(?:\s*\[([^\]]*)\]|\s*\{([^}]*)\}|\s*\(([^)]*)\))?\s*[-=]+(?:>|>)\s*(?:\|([^|]*)\|\s*)?([\w-]+)(?:\s*\[([^\]]*)\]|\s*\{([^}]*)\}|\s*\(([^)]*)\))?/);
    if (!connection) continue;
    const [, sourceId, sourceBox, sourceDecision, sourceTerminator, label, targetId, targetBox, targetDecision, targetTerminator] = connection;
    ensureNode(sourceId, sourceBox ?? sourceDecision ?? sourceTerminator ?? sourceId, sourceDecision ? 'decision' : sourceTerminator ? 'terminator' : undefined);
    ensureNode(targetId, targetBox ?? targetDecision ?? targetTerminator ?? targetId, targetDecision ? 'decision' : targetTerminator ? 'terminator' : undefined);
    edges.push({ id: edgeId(sourceId, targetId, index++), source: sourceId, target: targetId, type: 'smoothstep', markerEnd: { type: 'arrowclosed' }, data: { label: label?.trim(), routing: 'orthogonal', endMarker: 'closed-arrow' } });
  }
  return makeDocument([...nodes.values()], edges);
}

export function parseCsvFlowchart(source: string): FlowDocument {
  const rows = source.split(/\r?\n/).filter(Boolean).map((line) => line.split(',').map((value) => value.trim().replace(/^"|"$/g, '')));
  if (!rows.length) return makeDocument([], []);
  const headers = rows[0].map((header) => header.toLowerCase());
  const indexOf = (...names: string[]) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const idIndex = indexOf('id', 'node', 'name');
  const labelIndex = indexOf('label', 'text', 'title');
  const sourceIndex = indexOf('source', 'from', 'parent');
  const targetIndex = indexOf('target', 'to', 'child');
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const id = row[idIndex >= 0 ? idIndex : 0] || `node-${rowIndex + 1}`;
    if (!nodes.has(id)) nodes.set(id, createNode('process', 120 + nodes.size * 180, 120 + (nodes.size % 4) * 100, row[labelIndex >= 0 ? labelIndex : 0] || id));
    if (sourceIndex >= 0 && targetIndex >= 0 && row[sourceIndex] && row[targetIndex]) {
      const source = row[sourceIndex];
      const target = row[targetIndex];
      if (!nodes.has(source)) nodes.set(source, createNode('process', 120 + nodes.size * 180, 120, source));
      if (!nodes.has(target)) nodes.set(target, createNode('process', 120 + nodes.size * 180, 220, target));
      edges.push({ id: edgeId(source, target, rowIndex), source, target, type: 'smoothstep', markerEnd: { type: 'arrowclosed' }, data: { routing: 'orthogonal', endMarker: 'closed-arrow' } });
    }
  });
  return makeDocument([...nodes.values()], edges);
}

export function parseSqlFlowchart(source: string): FlowDocument {
  const nodes = new Map<string, FlowNode>();
  const edges: FlowEdge[] = [];
  const tablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:["`\x5b])?([\w.-]+)(?:["`\x5d])?\s*\(([^;]+)\)\s*;/gi;
  let tableMatch: RegExpExecArray | null;
  let tableIndex = 0;
  while ((tableMatch = tablePattern.exec(source)) !== null) {
    const tableName = tableMatch[1];
    const body = tableMatch[2];
    const node = createNode('database', 140 + tableIndex * 220, 120 + (tableIndex % 3) * 130, tableName);
    node.id = tableName;
    nodes.set(tableName, node);
    tableIndex += 1;
    const foreignKeyPattern = /FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+(?:["`\x5b])?([\w.-]+)(?:["`\x5d])?/gi;
    let foreignKey: RegExpExecArray | null;
    while ((foreignKey = foreignKeyPattern.exec(body)) !== null) {
      const target = foreignKey[1];
      if (!nodes.has(target)) {
        const targetNode = createNode('database', 140 + nodes.size * 220, 300, target);
        targetNode.id = target;
        nodes.set(target, targetNode);
      }
      edges.push({ id: edgeId(tableName, target, edges.length), source: tableName, target, type: 'smoothstep', markerEnd: { type: 'arrowclosed' }, data: { routing: 'orthogonal', endMarker: 'closed-arrow' } });
    }
    const columnNames = body.split(',').map((part) => part.trim().split(/\s+/)[0]).filter((column) => /^[A-Za-z_][\w$]*$/.test(column));
    node.data.label = `${tableName}\n${columnNames.slice(0, 6).join('\n')}`;
  }
  return makeDocument([...nodes.values()], edges);
}

export function flowToMermaid(document: FlowDocument): string {
  const lines = ['flowchart LR'];
  const page = document.pages.find((item) => item.id === document.activePageId) ?? { nodes: document.nodes, edges: document.edges };
  const byId = new Map(page.nodes.map((node) => [node.id, node]));
  page.nodes.forEach((node) => {
    const label = String(node.data.label).replace(/[[\]{}()]/g, '');
    const syntax = node.data.semanticType === 'decision' ? `{${label}}` : node.data.semanticType === 'terminator' ? `(${label})` : `[${label}]`;
    lines.push(`  ${node.id}${syntax}`);
  });
  page.edges.forEach((edge) => {
    if (!byId.has(edge.source) || !byId.has(edge.target)) return;
    const label = edge.data?.label ? `|${String(edge.data.label).replace(/\|/g, '/') }|` : '';
    lines.push(`  ${edge.source} -->${label} ${edge.target}`);
  });
  return lines.join('\n');
}

export function makeDocument(nodes: FlowNode[], edges: FlowEdge[]): FlowDocument {
  const page = { id: 'page-1', name: '第 1 页', nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, layers: [{ id: 'layer-default', name: '默认图层', visible: true, locked: false }] };
  return { schemaVersion: 2, pages: [page], activePageId: page.id, nodes, edges, viewport: page.viewport };
}

export function parseStructuredFlowJson(source: string): FlowDocument {
  const value = JSON.parse(source) as { nodes?: FlowNode[]; edges?: FlowEdge[]; pages?: FlowDocument['pages']; activePageId?: string };
  if (Array.isArray(value.pages)) {
    const page = value.pages.find((item) => item.id === value.activePageId) ?? value.pages[0];
    if (page) return { schemaVersion: 2, pages: value.pages, activePageId: page.id, nodes: page.nodes, edges: page.edges, viewport: page.viewport };
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) throw new Error('结构化流程图 JSON 必须包含 nodes 和 edges');
  return makeDocument(value.nodes, value.edges);
}

export function flowToCsv(document: FlowDocument): string {
  const page = document.pages.find((item) => item.id === document.activePageId) ?? { nodes: document.nodes, edges: document.edges };
  const rows = ['id,label,source,target,type'];
  const incoming = new Set(page.edges.map((edge) => edge.target));
  page.nodes.forEach((node) => {
    const outgoing = page.edges.filter((edge) => edge.source === node.id);
    if (!outgoing.length) rows.push(`${node.id},${JSON.stringify(node.data.label)},,,${node.data.semanticType}`);
    outgoing.forEach((edge) => rows.push(`${node.id},${JSON.stringify(node.data.label)},${edge.source},${edge.target},${node.data.semanticType}`));
  });
  if (!incoming.size && page.nodes.length) rows.push(...page.nodes.slice(1).map((node) => `${node.id},${JSON.stringify(node.data.label)},,,${node.data.semanticType}`));
  return rows.join('\n');
}

export function flowToDrawioXml(document: FlowDocument): string {
  const page = document.pages.find((item) => item.id === document.activePageId) ?? { nodes: document.nodes, edges: document.edges };
  const cells = page.nodes.map((node) => `<mxCell id="${escapeXml(node.id)}" value="${escapeXml(node.data.label)}" vertex="1" style="shape=${node.data.semanticType};fillColor=${escapeXml(node.data.fill)};strokeColor=${escapeXml(node.data.stroke)};"><mxGeometry x="${node.position.x}" y="${node.position.y}" width="${node.data.width}" height="${node.data.height}" as="geometry"/></mxCell>`);
  cells.push(...page.edges.map((edge) => `<mxCell id="${escapeXml(edge.id)}" edge="1" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}" value="${escapeXml(edge.data?.label ?? '')}"/>`));
  return `<mxfile host="Niuery Toolkit"><diagram name="${escapeXml('name' in page ? page.name : '第 1 页')}"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram></mxfile>`;
}

export function parseDrawioXml(source: string): FlowDocument {
  const xml = new DOMParser().parseFromString(source, 'application/xml');
  if (xml.querySelector('parsererror')) throw new Error('draw.io XML 格式无效');
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  xml.querySelectorAll('mxCell').forEach((cell) => {
    const id = cell.getAttribute('id');
    if (!id || id === '0' || id === '1') return;
    const sourceId = cell.getAttribute('source');
    const targetId = cell.getAttribute('target');
    if (sourceId && targetId) {
      edges.push({ id, source: sourceId, target: targetId, type: 'smoothstep', markerEnd: { type: 'arrowclosed' }, data: { label: cell.getAttribute('value') ?? '', routing: 'orthogonal', endMarker: 'closed-arrow' } });
      return;
    }
    const geometry = cell.querySelector('mxGeometry');
    const style = cell.getAttribute('style') ?? '';
    const semantic = style.includes('decision') ? 'decision' : style.includes('terminator') ? 'terminator' : 'process';
    const node = createNode(semantic, Number(geometry?.getAttribute('x') ?? 0), Number(geometry?.getAttribute('y') ?? 0), cell.getAttribute('value') ?? id);
    node.id = id;
    nodes.push(node);
  });
  return makeDocument(nodes, edges);
}

function escapeXml(value: string) { return value.replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character); }
