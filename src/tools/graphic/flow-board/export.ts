import type { Edge, Node } from '@xyflow/react';
import type { FlowNodeData } from './types';

interface ExportNode extends Node<FlowNodeData> {
  width?: number;
  height?: number;
}

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character);
}

function nodeSize(node: ExportNode) {
  return { width: node.width ?? node.data.width ?? 150, height: node.height ?? node.data.height ?? 72 };
}

export function flowToSvg(nodes: ExportNode[], edges: Edge[]) {
  if (nodes.length === 0) throw new Error('画布为空，无法导出');
  const padding = 48;
  const bounds = nodes.reduce((result, node) => {
    const size = nodeSize(node);
    return { minX: Math.min(result.minX, node.position.x), minY: Math.min(result.minY, node.position.y), maxX: Math.max(result.maxX, node.position.x + size.width), maxY: Math.max(result.maxY, node.position.y + size.height) };
  }, { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
  const width = Math.max(1, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(1, bounds.maxY - bounds.minY + padding * 2);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const point = (node: ExportNode, side: 'source' | 'target') => {
    const size = nodeSize(node);
    return { x: node.position.x + (side === 'source' ? size.width : 0) - bounds.minX + padding, y: node.position.y + size.height / 2 - bounds.minY + padding };
  };
  const edgeSvg = edges.flatMap((edge) => {
    const source = nodeMap.get(edge.source);
    const target = nodeMap.get(edge.target);
    if (!source || !target) return [];
    const a = point(source, 'source');
    const b = point(target, 'target');
    return [`<path d="M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}" fill="none" stroke="#718096" stroke-width="2" marker-end="url(#arrow)"/>`];
  }).join('');
  const nodeSvg = nodes.map((node) => {
    const size = nodeSize(node);
    const x = node.position.x - bounds.minX + padding;
    const y = node.position.y - bounds.minY + padding;
    const data = node.data;
    const label = escapeXml(String(data.label ?? ''));
    const text = `<text x="${x + size.width / 2}" y="${y + size.height / 2 + 5}" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="${escapeXml(data.textColor)}">${label}</text>`;
    if (data.shape === 'circle') return `<circle cx="${x + size.width / 2}" cy="${y + size.height / 2}" r="${Math.min(size.width, size.height) / 2}" fill="${data.fill}" stroke="${data.stroke}" stroke-width="2"/>${text}`;
    if (data.shape === 'diamond') return `<polygon points="${x + size.width / 2},${y} ${x + size.width},${y + size.height / 2} ${x + size.width / 2},${y + size.height} ${x},${y + size.height / 2}" fill="${data.fill}" stroke="${data.stroke}" stroke-width="2"/>${text}`;
    return `<rect x="${x}" y="${y}" width="${size.width}" height="${size.height}" rx="${data.shape === 'rounded' ? 14 : 4}" fill="${data.fill}" stroke="${data.stroke}" stroke-width="2"/>${text}`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L0,8 L8,4 z" fill="#718096"/></marker></defs><rect width="100%" height="100%" fill="#ffffff"/>${edgeSvg}${nodeSvg}</svg>`;
}

export async function svgToPng(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('无法将 SVG 转换为 PNG'));
      element.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, image.naturalWidth * 2);
    canvas.height = Math.max(1, image.naturalHeight * 2);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前环境不支持 PNG 导出');
    context.scale(2, 2);
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成 PNG 文件')), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
