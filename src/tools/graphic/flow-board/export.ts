import type { Edge, Node } from '@xyflow/react';
import { absolutePosition, getEdgeGeometry, getNodeShape } from './geometry';
import type { FlowNodeData, FlowNode } from './types';
import { PDFDocument } from 'pdf-lib';

interface ExportNode extends Node<FlowNodeData> { width?: number; height?: number; }
function escapeXml(value: string) { return value.replace(/[<>&']/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;' })[character] ?? character); }
function nodeSize(node: ExportNode) { return { width: node.width && node.width > 0 ? node.width : node.data.width, height: node.height && node.height > 0 ? node.height : node.data.height }; }
function textSvg(x: number, y: number, data: FlowNodeData, size: { width: number; height: number }) {
  const maxChars = Math.max(6, Math.floor(size.width / Math.max(6, (data.fontSize ?? 14) * .65)));
  const text = String(data.label ?? ''); const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) for (let index = 0; index < raw.length || index === 0; index += maxChars) lines.push(raw.slice(index, index + maxChars));
  const lineHeight = (data.fontSize ?? 14) * 1.35;
  return lines.map((line, index) => `<text x="${x + size.width / 2}" y="${y + size.height / 2 + (index - (lines.length - 1) / 2) * lineHeight}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${data.fontSize ?? 14}" font-weight="${data.bold ? 700 : 400}" font-style="${data.italic ? 'italic' : 'normal'}" fill="${escapeXml(data.textColor)}"><tspan>${escapeXml(line)}</tspan></text>`).join('');
}
function marker(value: string, id: string) { return value === 'arrow' ? `url(#arrow-${id})` : value === 'closed-arrow' ? `url(#closed-arrow-${id})` : undefined; }
export function flowToSvg(nodes: ExportNode[], edges: Edge[]) {
  if (nodes.length === 0) throw new Error('画布为空，无法导出');
  const padding = 48; const absolute = nodes.map((node) => ({ ...node, position: absolutePosition(node as FlowNode, nodes as FlowNode[]) }));
  const geometryByEdge = edges.map((edge) => [edge, getEdgeGeometry(nodes as FlowNode[], edge as never)] as const);
  const nodeBounds = absolute.reduce((result, node) => { const size = nodeSize(node); return { minX: Math.min(result.minX, node.position.x), minY: Math.min(result.minY, node.position.y), maxX: Math.max(result.maxX, node.position.x + size.width), maxY: Math.max(result.maxY, node.position.y + size.height) }; }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const allPoints = geometryByEdge.flatMap(([, geometry]) => geometry.points); const minX = Math.min(nodeBounds.minX, ...allPoints.map((p) => p.x)); const minY = Math.min(nodeBounds.minY, ...allPoints.map((p) => p.y)); const maxX = Math.max(nodeBounds.maxX, ...allPoints.map((p) => p.x)); const maxY = Math.max(nodeBounds.maxY, ...allPoints.map((p) => p.y));
  const width = Math.max(1, maxX - minX + padding * 2); const height = Math.max(1, maxY - minY + padding * 2);
  const edgeSvg = geometryByEdge.flatMap(([edge, geometry]) => { if (!geometry.path) return []; const data = edge.data ?? {}; const start = marker(String(data.startMarker ?? 'none'), edge.id); const end = marker(String(data.endMarker ?? 'closed-arrow'), edge.id); return [`<path data-edge-id="${escapeXml(edge.id)}" d="${geometry.path}" fill="none" stroke="${escapeXml(String(data.stroke ?? '#66778c'))}" stroke-width="${data.strokeWidth ?? 2}" stroke-dasharray="${data.dashed ? '6 4' : 'none'}"${start ? ` marker-start="${start}"` : ''}${end ? ` marker-end="${end}"` : ''} transform="translate(${padding - minX} ${padding - minY})"/>${data.label ? `<text x="${geometry.label.x + padding - minX}" y="${geometry.label.y + padding - minY}" text-anchor="middle" font-size="12" fill="#334155"><tspan>${escapeXml(String(data.label))}</tspan></text>` : ''}`]; }).join('');
  const nodeSvg = absolute.map((node) => { const size = nodeSize(node); const data = node.data; const x = node.position.x - minX + padding; const y = node.position.y - minY + padding; const shape = getNodeShape(data); const paths = shape.paths.map((path, index) => `<path d="${path}" fill="${index === 0 && shape.fill ? escapeXml(data.fill) : 'none'}" stroke="${escapeXml(data.stroke)}" stroke-width="${data.strokeWidth ?? 2}" stroke-dasharray="${data.dashed ? '6 4' : 'none'}"/>`).join(''); return `<g data-node-id="${escapeXml(node.id)}" transform="translate(${x} ${y})">${paths}${textSvg(0, 0, data, size)}</g>`; }).join('');
  const defs = edges.map((edge) => `<marker id="closed-arrow-${escapeXml(edge.id)}" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L0,8 L8,4 z" fill="#66778c"/></marker><marker id="arrow-${escapeXml(edge.id)}" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#66778c"/></marker>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs}</defs><rect width="100%" height="100%" fill="#ffffff"/>${edgeSvg}${nodeSvg}</svg>`;
}

function base64Utf8(value: string) {
  const bytes = new TextEncoder().encode(value); let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function embedFlowJsonInSvg(svg: string, json: string) {
  const metadata = `<metadata id="flow-document" data-encoding="base64-json">${base64Utf8(json)}</metadata>`;
  return svg.replace('<defs>', `${metadata}<defs>`);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, bytes: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type); const body = new Uint8Array(typeBytes.length + bytes.length); body.set(typeBytes); body.set(bytes, typeBytes.length);
  const out = new Uint8Array(12 + bytes.length); const view = new DataView(out.buffer); view.setUint32(0, bytes.length); out.set(body, 4); view.setUint32(8 + bytes.length, crc32(body)); return out;
}
export async function embedFlowJsonInPng(blob: Blob, json: string) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); const signature = bytes.slice(0, 8); const result: Uint8Array[] = [signature]; let offset = 8;
  while (offset < bytes.length) { const length = new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0); const end = offset + 12 + length; const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8)); if (type === 'IEND') { const text = new TextEncoder().encode(`flow-json\0${json}`); result.push(chunk('tEXt', text)); } result.push(bytes.slice(offset, end)); offset = end; }
  const total = result.reduce((sum, item) => sum + item.length, 0); const merged = new Uint8Array(total); let cursor = 0; for (const item of result) { merged.set(item, cursor); cursor += item.length; }
  return new Blob([merged], { type: 'image/png' });
}
export async function embedFlowJsonInPdf(bytes: Uint8Array, json: string) {
  const document = await PDFDocument.load(bytes); await document.attach(new TextEncoder().encode(json), 'flow-document.json', { mimeType: 'application/json', description: 'Niuery Toolkit editable flow document' }); return document.save();
}
export async function svgToPng(svg: string) { const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })); try { const image = await new Promise<HTMLImageElement>((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error('无法将 SVG 转换为 PNG')); element.src = url; }); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, image.naturalWidth * 2); canvas.height = Math.max(1, image.naturalHeight * 2); const context = canvas.getContext('2d'); if (!context) throw new Error('当前环境不支持 PNG 导出'); context.scale(2, 2); context.drawImage(image, 0, 0); return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成 PNG 文件')), 'image/png')); } finally { URL.revokeObjectURL(url); } }
export function flowToHtml(svg: string, title = '流程图') { const safeTitle = title.replace(/[<>&"]/g, ''); return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${safeTitle}</title><style>html,body{margin:0;background:#f8fafc;font-family:system-ui,sans-serif}main{padding:32px;max-width:1400px;margin:auto;background:#fff;min-height:100vh}svg{max-width:100%;height:auto}</style></head><body><main>${svg}</main></body></html>`; }
export function flowToUrl(svg: string) { return `data:text/html;charset=utf-8,${encodeURIComponent(flowToHtml(svg))}`; }
