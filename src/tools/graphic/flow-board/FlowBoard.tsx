import {
  addEdge,
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Circle,
  Copy,
  Download,
  FilePlus2,
  FolderOpen,
  Grid3X3,
  HelpCircle,
  Maximize2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Palette,
  Plus,
  Redo2,
  Save,
  Search,
  Settings2,
  Square,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { saveBytes, saveBytesWithFeedback } from '@/lib/file-save';
import { openTextDocument } from '@/lib/local-documents';
import { isTauri } from '@/lib/api-client';
import { createDefaultFlowDocument, createEmptyFlowDocument, cloneFlowState, createNode, parseFlowDocument, serializeFlowDocument } from './document';
import { flowToSvg, svgToPng } from './export';
import { getFlowNodeDefinitions } from './node-registry';
import type { FlowDocument, FlowNode, FlowNodeData } from './types';
import { toast } from 'sonner';
import './styles.css';

const shapeIcons: Record<string, typeof Square> = {
  rectangle: Square,
  rounded: Square,
  circle: Circle,
  diamond: Square,
  text: Type,
};

function FlowNodeView({ data, selected }: NodeProps) {
  const nodeData = data as FlowNodeData;
  const className = nodeData.shape === 'diamond' ? 'flow-node flow-node-diamond' : `flow-node flow-node-${nodeData.shape}`;
  return (
    <div className={`${className}${selected ? ' is-selected' : ''}`} style={{ width: nodeData.width, height: nodeData.height, background: nodeData.fill, borderColor: nodeData.stroke, color: nodeData.textColor }}>
      <Handle type="target" position={Position.Left} id="left" />
      <Handle type="target" position={Position.Top} id="top" />
      <span>{nodeData.label}</span>
      <Handle type="source" position={Position.Right} id="right" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  );
}

const nodeTypes = { rectangle: FlowNodeView, rounded: FlowNodeView, circle: FlowNodeView, diamond: FlowNodeView, text: FlowNodeView };

function FlowBoardInner() {
  const [document, setDocument] = useState<FlowDocument>(() => createDefaultFlowDocument());
  const [nodes, setNodes, onNodesChange] = useNodesState(document.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(document.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [history, setHistory] = useState<FlowDocument[]>([]);
  const [future, setFuture] = useState<FlowDocument[]>([]);
  const [showGrid, setShowGrid] = useState(true);
  const [zoomLabel, setZoomLabel] = useState(100);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragSnapshotRef = useRef<FlowDocument | null>(null);
  const { setViewport, getViewport, screenToFlowPosition, fitView, zoomIn, zoomOut } = useReactFlow();

  const currentDocument = useCallback(() => cloneFlowState(nodes, edges, getViewport()), [edges, getViewport, nodes]);
  const applyDocument = useCallback((next: FlowDocument, record = true) => {
    if (record) setHistory((items) => [...items.slice(-49), currentDocument()]);
    if (record) setFuture([]);
    setDocument(next);
    setNodes(next.nodes);
    setEdges(next.edges);
    setViewport(next.viewport);
    setDirty(true);
  }, [currentDocument, setEdges, setNodes, setViewport]);

  const undo = useCallback(() => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setFuture((items) => [...items, currentDocument()]);
    setHistory((items) => items.slice(0, -1));
    applyDocument(previous, false);
  }, [applyDocument, currentDocument, history]);
  const redo = useCallback(() => {
    const next = future[future.length - 1];
    if (!next) return;
    setHistory((items) => [...items, currentDocument()]);
    setFuture((items) => items.slice(0, -1));
    applyDocument(next, false);
  }, [applyDocument, currentDocument, future]);
  const save = useCallback(async () => {
    const content = serializeFlowDocument(currentDocument());
    const path = await saveBytes(documentPath?.split(/[\\/]/).pop() ?? '未命名图表.json', new TextEncoder().encode(content), 'JSON 图表', ['json']);
    if (path) { setDocumentPath(path); setDirty(false); toast.success('图表已保存'); }
  }, [currentDocument, documentPath]);
  const openSource = useCallback((source: string, path: string | null) => {
    try { const next = parseFlowDocument(source); applyDocument(next, false); setHistory([]); setFuture([]); setDocumentPath(path); setDirty(false); toast.success('图表已打开'); }
    catch (error) { toast.error(`打开失败：${error instanceof Error ? error.message : String(error)}`); }
  }, [applyDocument]);
  const open = useCallback(async () => {
    if (dirty && !window.confirm('当前更改尚未保存，仍要打开其他图表吗？')) return;
    if (isTauri) { const result = await openTextDocument('JSON 图表', ['json']); if (result) openSource(result.contents, result.path); }
    else fileInputRef.current?.click();
  }, [dirty, openSource]);
  const exportImage = useCallback(async (format: 'svg' | 'png') => {
    try {
      const svg = flowToSvg(nodes as FlowNode[], edges);
      const blob = format === 'svg' ? new Blob([svg], { type: 'image/svg+xml' }) : await svgToPng(svg);
      await saveBytesWithFeedback(`图表.${format}`, blob, format.toUpperCase(), [format]);
    } catch (error) { toast.error(`导出失败：${error instanceof Error ? error.message : String(error)}`); }
  }, [edges, nodes]);

  const addNode = useCallback((type: string, position?: { x: number; y: number }) => {
    const nextNode = createNode(type, position?.x ?? 180 + nodes.length * 24, position?.y ?? 140 + nodes.length * 18);
    applyDocument({ ...currentDocument(), nodes: [...nodes, nextNode] });
    setSelectedId(nextNode.id);
  }, [applyDocument, currentDocument, nodes]);
  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    applyDocument({ ...currentDocument(), nodes: nodes.filter((node) => node.id !== selectedId), edges: edges.filter((edge) => edge.source !== selectedId && edge.target !== selectedId) });
    setSelectedId(null);
  }, [applyDocument, currentDocument, edges, nodes, selectedId]);
  const duplicateSelected = useCallback(() => {
    const selected = nodes.find((node) => node.id === selectedId);
    if (!selected) return;
    const copy = { ...selected, id: `${selected.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, position: { x: selected.position.x + 36, y: selected.position.y + 36 }, data: { ...selected.data } };
    applyDocument({ ...currentDocument(), nodes: [...nodes, copy] });
    setSelectedId(copy.id);
  }, [applyDocument, currentDocument, nodes, selectedId]);
  const updateSelected = useCallback((patch: Partial<FlowNodeData>) => {
    if (!selectedId) return;
    applyDocument({ ...currentDocument(), nodes: nodes.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node) });
  }, [applyDocument, currentDocument, nodes, selectedId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') { if (selectedId) { event.preventDefault(); deleteSelected(); } return; }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 's') { event.preventDefault(); void save(); }
      if (event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      if (event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if (event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelected(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteSelected, duplicateSelected, redo, save, selectedId, undo]);

  const definitions = useMemo(() => getFlowNodeDefinitions(), []);
  const selectedNode = nodes.find((node) => node.id === selectedId);
  const selectedData = selectedNode?.data as FlowNodeData | undefined;
  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/flow-node');
    if (!type) return;
    addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [addNode, screenToFlowPosition]);

  return (
    <section className="flow-board flex h-full min-h-0 flex-col bg-[#f3f4f6] text-[#263238]">
      <header className="flow-topbar shrink-0">
        <div className="flow-brand"><div className="flow-brand-mark">N</div><div><strong>Niuery Draw</strong><span>{documentPath?.split(/[\\/]/).pop() ?? '未命名图表'}{dirty ? ' ·' : ''}</span></div></div>
        <div className="flow-menu-row">
          {['文件', '编辑', '查看', '排列', '帮助'].map((menu) => <button key={menu} className={`flow-menu ${activeMenu === menu ? 'active' : ''}`} onClick={() => setActiveMenu(activeMenu === menu ? null : menu)}>{menu}<ChevronDown size={13} /></button>)}
        </div>
        <div className="flow-top-actions"><button title="设置"><Settings2 size={16} /></button><button title="帮助"><HelpCircle size={16} /></button><button className="flow-avatar">N</button></div>
      </header>
      <div className="flow-toolbar shrink-0">
        <button className="flow-tool-btn" title="新建" onClick={() => applyDocument(createEmptyFlowDocument())}><FilePlus2 size={17} /></button>
        <button className="flow-tool-btn" title="打开" onClick={open}><FolderOpen size={17} /></button>
        <button className="flow-tool-btn" title="保存" onClick={() => void save()}><Save size={17} /></button>
        <span className="flow-divider" />
        <button className="flow-tool-btn" title="撤销" disabled={!history.length} onClick={undo}><Undo2 size={17} /></button>
        <button className="flow-tool-btn" title="重做" disabled={!future.length} onClick={redo}><Redo2 size={17} /></button>
        <span className="flow-divider" />
        <button className="flow-tool-btn active" title="选择"><MousePointer2 size={17} /></button>
        <button className="flow-tool-btn" title="文本" onClick={() => addNode('text')}><Type size={17} /></button>
        <button className="flow-tool-btn" title="连接"><ArrowRight size={17} /></button>
        <span className="flow-divider" />
        <button className="flow-tool-btn" title="复制" disabled={!selectedNode} onClick={duplicateSelected}><Copy size={17} /></button>
        <button className="flow-tool-btn" title="删除" disabled={!selectedNode} onClick={deleteSelected}><Trash2 size={17} /></button>
        <div className="flow-toolbar-spacer" />
        <button className="flow-export-btn" onClick={() => void exportImage('svg')}><Download size={15} />导出 SVG</button>
        <button className="flow-tool-btn" title="更多"><MoreHorizontal size={17} /></button>
      </div>
      <div className="flow-main min-h-0 flex-1">
        <aside className="flow-sidebar">
          <div className="flow-sidebar-search"><Search size={15} /><input placeholder="搜索图形" /></div>
          <div className="flow-sidebar-section"><div className="flow-section-title"><span>通用</span><ChevronDown size={14} /></div>{definitions.map((definition) => { const Icon = shapeIcons[definition.type] ?? Square; return <button key={definition.type} className="flow-shape-item" draggable onDragStart={(event) => event.dataTransfer.setData('application/flow-node', definition.type)} onClick={() => addNode(definition.type)}><span className={`flow-shape-preview preview-${definition.shape}`}><Icon size={18} /></span><span>{definition.label}</span><Plus size={13} className="flow-shape-add" /></button>; })}</div>
          <div className="flow-sidebar-section"><div className="flow-section-title"><span>流程图</span><ChevronDown size={14} /></div><button className="flow-shape-item" onClick={() => addNode('rounded')}><span className="flow-shape-preview preview-process"><Square size={18} /></span><span>流程</span></button><button className="flow-shape-item" onClick={() => addNode('diamond')}><span className="flow-shape-preview preview-decision"><Square size={18} /></span><span>决策</span></button></div>
          <div className="flow-sidebar-footer"><button><Plus size={15} />更多图形</button></div>
        </aside>
        <div className="flow-canvas" onDrop={handleDrop} onDragOver={(event) => event.preventDefault()}>
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={(changes) => { onNodesChange(changes); setDirty(true); }} onEdgesChange={(changes) => { onEdgesChange(changes); setDirty(true); }} onConnect={(connection: Connection) => { applyDocument({ ...currentDocument(), edges: addEdge({ ...connection, type: ConnectionLineType.SmoothStep, markerEnd: { type: MarkerType.ArrowClosed } }, edges) }); }} onNodeClick={(_, node) => setSelectedId(node.id)} onPaneClick={() => setSelectedId(null)} onNodeDragStart={() => { dragSnapshotRef.current = currentDocument(); }} onNodeDragStop={() => { if (dragSnapshotRef.current) { setHistory((items) => [...items.slice(-49), dragSnapshotRef.current!]); setFuture([]); dragSnapshotRef.current = null; setDirty(true); } }} onMoveEnd={(_, viewport) => { setDocument((value) => ({ ...value, viewport })); setZoomLabel(Math.round(viewport.zoom * 100)); }} connectionLineType={ConnectionLineType.SmoothStep} fitView defaultViewport={document.viewport} minZoom={0.1} maxZoom={4} deleteKeyCode="Delete" selectionOnDrag>
            {showGrid && <Background variant={BackgroundVariant.Lines} gap={20} size={1} color="#d7dce3" />}
            <MiniMap className="flow-minimap" pannable zoomable nodeColor={(node) => String((node.data as FlowNodeData).stroke)} />
            <Panel position="top-right" className="flow-canvas-tools"><button onClick={() => setShowGrid((value) => !value)} className={showGrid ? 'active' : ''} title="网格"><Grid3X3 size={15} /></button><button onClick={() => fitView({ padding: 0.2 })} title="适应画布"><Maximize2 size={15} /></button></Panel>
            <Panel position="bottom-center" className="flow-zoom-controls"><button onClick={() => { void zoomOut(); }}><Minus size={14} /></button><span>{zoomLabel}%</span><button onClick={() => { void zoomIn(); }}><Plus size={14} /></button></Panel>
          </ReactFlow>
        </div>
        <aside className="flow-inspector">
          <div className="flow-inspector-tabs"><button className="active"><Palette size={14} />格式</button><button><Settings2 size={14} />数据</button></div>
          {selectedData ? <div className="flow-inspector-body"><div className="flow-inspector-heading"><span>形状样式</span><button onClick={deleteSelected}><Trash2 size={15} /></button></div><label>文本<input value={selectedData.label} onChange={(event) => updateSelected({ label: event.target.value })} /></label><div className="flow-field-row"><label>填充<input type="color" value={selectedData.fill === 'transparent' ? '#ffffff' : selectedData.fill} onChange={(event) => updateSelected({ fill: event.target.value })} /></label><label>边框<input type="color" value={selectedData.stroke === 'transparent' ? '#ffffff' : selectedData.stroke} onChange={(event) => updateSelected({ stroke: event.target.value })} /></label></div><label>宽度<input type="number" min="40" value={selectedData.width} onChange={(event) => updateSelected({ width: Math.max(40, Number(event.target.value) || 40) })} /></label><label>高度<input type="number" min="30" value={selectedData.height} onChange={(event) => updateSelected({ height: Math.max(30, Number(event.target.value) || 30) })} /></label><div className="flow-inspector-heading"><span>对齐</span></div><div className="flow-align-row"><button onClick={() => updateSelected({ textColor: selectedData.textColor })}><AlignLeft size={15} /></button><button><AlignCenter size={15} /></button><button><AlignRight size={15} /></button></div><div className="flow-inspector-heading"><span>图层</span></div><div className="flow-layer-row"><button><ArrowUp size={15} />置于顶层</button><button><ArrowDown size={15} />置于底层</button></div></div> : <div className="flow-empty-inspector"><Palette size={24} /><p>选择一个图形<br />查看和编辑属性</p></div>}
        </aside>
      </div>
      <footer className="flow-statusbar"><span><span className="flow-status-dot" />已保存到本地</span><span>{nodes.length} 个图形 · {edges.length} 条连接</span><span className="flow-status-spacer" /><span>画布 1</span><button onClick={() => setShowGrid((value) => !value)}><Grid3X3 size={13} />{showGrid ? '网格已开启' : '网格已关闭'}</button></footer>
      <input ref={fileInputRef} className="hidden" type="file" accept=".json,application/json" onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void file.text().then((source) => openSource(source, file.name)); event.currentTarget.value = ''; }} />
    </section>
  );
}

export default function FlowBoard() {
  return <ReactFlowProvider><FlowBoardInner /></ReactFlowProvider>;
}
