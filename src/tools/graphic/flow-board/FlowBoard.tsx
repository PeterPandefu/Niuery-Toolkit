import {
  addEdge, applyNodeChanges, applyEdgeChanges, Background, BackgroundVariant, ConnectionMode, ConnectionLineType, MarkerType,
  MiniMap, Panel, ReactFlow, ReactFlowProvider, useReactFlow, type NodeChange, type EdgeChange, type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Copy, Download, FilePlus2, FolderOpen, Grid3X3, Layout, Maximize2, Minus, MousePointer2, Plus, Redo2, Save, Search, Trash2, Undo2, Waypoints } from 'lucide-react';
import { toast } from 'sonner';
import { saveBytes, saveBytesWithFeedback } from '@/lib/file-save';
import { openTextDocument } from '@/lib/local-documents';
import { isTauri } from '@/lib/api-client';
import { createDefaultFlowDocument, createEmptyFlowDocument, createNode, parseFlowDocument, serializeFlowDocument, syncActivePage } from './document';
import { embedFlowJsonInPdf, embedFlowJsonInPng, embedFlowJsonInSvg, flowToHtml, flowToSvg, flowToUrl, svgToPng } from './export';
import { getFlowNodeDefinitions } from './node-registry';
import { addPage, alignNodes, autoLayout, distributeNodes, duplicateSelection, getPageNodes, groupNodes, removeNodes, reorderNodes, setLayerState, ungroupNodes, updateEdges } from './operations';
import { FLOW_AI_PROMPT, flowToCsv, flowToDrawioXml, flowToMermaid, parseCsvFlowchart, parseDrawioXml, parseMermaidFlowchart, parseSqlFlowchart, parseStructuredFlowJson } from './interop';
import { FlowNodeView, FlowEdgeView } from './canvas';
import { CanvasActionsContext } from './canvas-context';
import { FlowInspector } from './inspector';
import { createEditorState, editorReducer, isDocumentDirty, type EditorAction } from './history';
import { FLOW_TEMPLATES } from './templates';
import type { FlowDocument, FlowEdge, FlowNode, FlowNodeData } from './types';
import './styles.css';

const nodeTypes = Object.fromEntries(getFlowNodeDefinitions().map((definition) => [definition.type, FlowNodeView]));
const edgeTypes = { 'flow-edge': FlowEdgeView };
const draftKey = 'niuery-flow-board-recovery-v2';
type ImportKind = 'mermaid' | 'csv' | 'sql' | 'json' | 'xml';
function parseSource(source: string, kind: ImportKind) {
  const result = kind === 'mermaid' ? parseMermaidFlowchart(source) : kind === 'csv' ? parseCsvFlowchart(source)
    : kind === 'sql' ? parseSqlFlowchart(source) : kind === 'xml' ? parseDrawioXml(source) : parseStructuredFlowJson(source);
  if (!result.nodes.length) throw new Error('未识别到图形，请检查输入格式');
  return parseFlowDocument(serializeFlowDocument(result));
}
function initialDocument() {
  try { const draft = localStorage.getItem(draftKey); if (draft) return parseFlowDocument(draft); } catch { /* Optional recovery storage. */ }
  return createDefaultFlowDocument();
}

function FlowBoardInner() {
  const [state, setState] = useState(() => createEditorState(initialDocument()));
  const stateRef = useRef(state);
  const { document } = state;
  const { nodes, edges } = document;
  const page = document.pages.find((item) => item.id === document.activePageId)!;
  const [path, setPath] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<string | null>(null);
  const [inspector, setInspector] = useState<'format' | 'layers'>('format');
  const [tool, setTool] = useState<'select' | 'connect'>('select');
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [sourceDialog, setSourceDialog] = useState(false);
  const [source, setSource] = useState('');
  const [sourceKind, setSourceKind] = useState<ImportKind>('mermaid');
  const [pendingImport, setPendingImport] = useState<FlowDocument | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [help, setHelp] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const clipboard = useRef<{ nodes: FlowNode[]; edges: FlowEdge[]; ids: string[] } | null>(null);
  const root = useRef<HTMLElement>(null);
  const { setViewport, fitView, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow<FlowNode, FlowEdge>();
  const send = useCallback((action: EditorAction) => {
    const next = editorReducer(stateRef.current, action);
    stateRef.current = next;
    setState(next);
  }, []);
  const commit = useCallback((next: FlowDocument) => send({ type: 'commit', document: syncActivePage(next) }), [send]);
  const begin = useCallback(() => { if (!stateRef.current.transaction) send({ type: 'begin' }); }, [send]);
  const finish = useCallback(() => send({ type: 'finish' }), [send]);
  const change = useCallback((next: FlowDocument) => send({ type: stateRef.current.transaction ? 'preview' : 'commit', document: syncActivePage(next) }), [send]);
  const dirty = isDocumentDirty(state);
  const selectedNodes = nodes.filter((node) => node.selected);
  const selectedIds = selectedNodes.map((node) => node.id);
  const selectedEdges = edges.filter((edge) => edge.selected);
  const selectedNode = selectedNodes[0];
  const selectedEdge = selectedEdges[0];
  const projectedNodes = useMemo(() => getPageNodes(page), [page]);
  const availableIds = new Set(projectedNodes.filter((node) => !node.hidden).map((node) => node.id));
  const editableIds = new Set(projectedNodes.filter((node) => !node.hidden && node.draggable !== false).map((node) => node.id));

  useEffect(() => { void setViewport(document.viewport); }, [document.activePageId, document.viewport, setViewport]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { if (dirty) localStorage.setItem(draftKey, serializeFlowDocument(stateRef.current.document)); else localStorage.removeItem(draftKey); } catch { /* File saving remains available. */ }
    }, 600);
    return () => clearTimeout(timer);
  }, [dirty, document]);
  useEffect(() => {
    const onUnload = (event: BeforeUnloadEvent) => { if (isDocumentDirty(stateRef.current)) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', onUnload); return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const updateNode = useCallback((id: string, patch: Partial<FlowNodeData>) => {
    const current = stateRef.current.document;
    change({ ...current, nodes: current.nodes.map((node) => node.id === id ? {
      ...node, width: patch.width ?? node.data.width, height: patch.height ?? node.data.height,
      style: { ...node.style, width: patch.width ?? node.data.width, height: patch.height ?? node.data.height }, data: { ...node.data, ...patch },
    } : node) });
  }, [change]);
  const updateEdge = useCallback((id: string, patch: NonNullable<FlowEdge['data']>) => {
    const current = stateRef.current.document; change({ ...current, edges: updateEdges(current.edges, [id], patch) });
  }, [change]);
  const actions = useMemo(() => ({ begin, finish, updateNode, updateEdge }), [begin, finish, updateNode, updateEdge]);
  const current = () => stateRef.current.document;
  const save = async () => {
    const saving = current();
    try {
      const result = await saveBytes(path?.split(/[\\/]/).pop() ?? '未命名流程图.json', new TextEncoder().encode(serializeFlowDocument(saving)), '流程图 JSON', ['json']);
      if (result) { setPath(result); send({ type: 'saved', document: saving }); toast.success('流程图已保存'); }
    } catch (error) { toast.error(String(error)); }
  };
  const restore = (action: 'undo' | 'redo') => { finish(); send({ type: action }); void setViewport(stateRef.current.document.viewport); };
  const addNode = (type: string, position?: { x: number; y: number }) => {
    const rect = root.current?.querySelector('.flow-canvas')?.getBoundingClientRect();
    const p = position ?? screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 400) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 300) / 2 });
    const node = createNode(type, p.x - 75, p.y - 36);
    node.data.layerId = page.layers.find((layer) => layer.visible && !layer.locked)?.id ?? page.layers[0].id;
    node.selected = true;
    commit({ ...current(), nodes: [...nodes.map((item) => ({ ...item, selected: false })), node], edges: edges.map((edge) => ({ ...edge, selected: false })) });
    setInspector('format');
  };
  const duplicate = () => { if (!selectedIds.length) return; commit({ ...current(), ...duplicateSelection(nodes, edges, selectedIds) }); };
  const copy = () => { clipboard.current = { nodes: structuredClone(nodes), edges: structuredClone(edges), ids: [...selectedIds] }; };
  const paste = () => {
    const copied = clipboard.current; if (!copied?.ids.length) return;
    const duplicated = duplicateSelection(copied.nodes, copied.edges, copied.ids);
    commit({ ...current(), nodes: [...nodes.map((node) => ({ ...node, selected: false })), ...duplicated.nodes.slice(copied.nodes.length)], edges: [...edges, ...duplicated.edges.slice(copied.edges.length)] });
  };
  const deleteSelection = () => {
    const result = removeNodes(nodes, edges, selectedIds.filter((id) => editableIds.has(id)));
    commit({ ...current(), ...result, edges: result.edges.filter((edge) => !edge.selected) }); setPendingDelete(false);
  };
  const arrange = (action: string) => {
    finish();
    const nextNodes = action === 'front' || action === 'back' ? reorderNodes(nodes, selectedIds, action)
      : action === 'horizontal' || action === 'vertical' ? distributeNodes(nodes, selectedIds, action)
      : alignNodes(nodes, selectedIds, action as Parameters<typeof alignNodes>[2]);
    commit({ ...current(), nodes: nextNodes });
  };
  const group = (kind: 'container' | 'swimlane') => {
    commit({ ...current(), nodes: groupNodes(nodes, selectedIds, kind === 'swimlane' ? '泳道' : '组合', kind) });
  };
  const layoutPage = (direction: 'horizontal' | 'vertical') => {
    commit({ ...current(), nodes: autoLayout(nodes, edges, direction) }); requestAnimationFrame(() => void fitView({ padding: .2 }));
  };
  const switchPage = (id: string) => {
    finish(); const doc = current(); const target = doc.pages.find((item) => item.id === id); if (!target) return;
    send({ type: 'preview', document: { ...doc, activePageId: id, nodes: target.nodes, edges: target.edges, viewport: target.viewport } });
    setMenu(null);
  };
  const newPage = () => {
    const doc = current(); const id = 'page-' + crypto.randomUUID(); const pages = addPage(doc.pages, id, '第 ' + (doc.pages.length + 1) + ' 页');
    const target = pages[pages.length - 1]; commit({ ...doc, pages, activePageId: id, nodes: [], edges: [], viewport: target.viewport });
  };
  const renamePage = () => { const name = window.prompt('页面名称', page.name); if (name?.trim()) commit({ ...current(), pages: document.pages.map((item) => item.id === page.id ? { ...item, name: name.trim() } : item) }); };
  const deletePage = () => {
    if (document.pages.length <= 1 || !window.confirm('删除此页及其内容？可以撤销。')) return;
    const pages = document.pages.filter((item) => item.id !== page.id); const target = pages[0];
    commit({ ...current(), pages, activePageId: target.id, nodes: target.nodes, edges: target.edges, viewport: target.viewport });
  };
  const setLayer = (id: string, patch: Parameters<typeof setLayerState>[2]) => {
    const doc = current(); const active = doc.pages.find((item) => item.id === doc.activePageId)!;
    const next = setLayerState(active, id, patch);
    commit({ ...doc, pages: doc.pages.map((item) => item.id === active.id ? next : item), nodes: doc.nodes.map((node) => ({ ...node, selected: false })) });
  };
  const addLayer = () => {
    const layer = { id: 'layer-' + crypto.randomUUID(), name: '图层 ' + (page.layers.length + 1), visible: true, locked: false };
    commit({ ...current(), pages: document.pages.map((item) => item.id === page.id ? { ...item, layers: [...item.layers, layer] } : item) });
  };
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const doc = current();
    const allowed = changes.filter((c) => !('id' in c) || c.type === 'dimensions' || c.type === 'select' || editableIds.has(c.id));
    const nextNodes = applyNodeChanges(allowed, doc.nodes).map((node) => {
      const resize = allowed.find((c) => c.type === 'dimensions' && c.id === node.id);
      return resize?.type === 'dimensions' && resize.setAttributes && resize.dimensions ? { ...node, data: { ...node.data, ...resize.dimensions }, style: { ...node.style, ...resize.dimensions } } : node;
    });
    const next = syncActivePage({ ...doc, nodes: nextNodes });
    if (allowed.every((c) => c.type === 'select' || c.type === 'dimensions' && !c.setAttributes)) send({ type: 'preview', document: next });
    else change(next);
  };
  const onEdgesChange = (changes: EdgeChange<FlowEdge>[]) => {
    const next = { ...current(), edges: applyEdgeChanges(changes, current().edges) };
    if (changes.every((c) => c.type === 'select')) send({ type: 'preview', document: next }); else change(next);
  };
  const connect = (connection: Connection) => {
    if (!connection.source || !connection.target || !editableIds.has(connection.source) || !editableIds.has(connection.target)) return;
    commit({ ...current(), edges: addEdge({ ...connection, type: 'flow-edge', data: { routing: 'orthogonal', endMarker: 'closed-arrow', startMarker: 'none' } }, current().edges) });
  };
  const loadFile = async (file: File) => {
    try {
      const text = await file.text(); const extension = file.name.split('.').pop()?.toLowerCase();
      const kind: ImportKind = extension === 'csv' ? 'csv' : extension === 'sql' ? 'sql' : extension === 'xml' || extension === 'drawio' ? 'xml' : extension === 'json' ? 'json' : 'mermaid';
      const result = kind === 'json' ? parseFlowDocument(text) : parseSource(text, kind);
      setPendingImport(result); setSourceDialog(true); setSource(text); setSourceKind(kind); setSourceError('');
    } catch (error) { toast.error('打开失败：' + String(error)); }
  };
  const open = async () => {
    try {
      if (isTauri) {
        const result = await openTextDocument('流程图', ['json', 'mmd', 'mermaid', 'csv', 'sql', 'drawio', 'xml']);
        if (result) { setPendingImport(parseSource(result.contents, result.path.endsWith('.json') ? 'json' : result.path.endsWith('.csv') ? 'csv' : result.path.endsWith('.sql') ? 'sql' : result.path.endsWith('.xml') || result.path.endsWith('.drawio') ? 'xml' : 'mermaid')); setSourceDialog(true); }
      } else fileInput.current?.click();
    } catch (error) { toast.error(String(error)); }
  };
  const exportFile = async (format: string) => {
    setMenu(null);
    try {
      if (format === 'json') { await save(); return; }
      if (format === 'mermaid' || format === 'csv' || format === 'drawio') {
        const text = format === 'mermaid' ? flowToMermaid(current()) : format === 'csv' ? flowToCsv(current()) : flowToDrawioXml(current());
        const ext = format === 'mermaid' ? 'mmd' : format;
        await saveBytesWithFeedback('流程图.' + ext, new TextEncoder().encode(text), format, [ext]); return;
      }
      const visibleNodes = getPageNodes(page).filter((node) => !node.hidden);
      const json = serializeFlowDocument(current());
      const svg = embedFlowJsonInSvg(flowToSvg(visibleNodes, edges), json);
      if (format === 'url') { await navigator.clipboard.writeText(flowToUrl(svg)); toast.success('URL 已复制'); return; }
      const data = format === 'svg' ? new Blob([svg], { type: 'image/svg+xml' })
        : format === 'png' ? await embedFlowJsonInPng(await svgToPng(svg), json)
        : format === 'html' ? new Blob([flowToHtml(svg)], { type: 'text/html' })
        : await embedFlowJsonInPdf(new Uint8Array(await invoke<number[]>('render_html_to_pdf', { html: flowToHtml(svg) })), json);
      await saveBytesWithFeedback('流程图.' + format, data, format.toUpperCase(), [format]);
    } catch (error) { toast.error('导出失败：' + String(error)); }
  };
  const newDocument = () => {
    if (dirty && !window.confirm('当前更改尚未保存，仍要新建？')) return;
    send({ type: 'load', document: createEmptyFlowDocument() }); setPath(null); setMenu(null);
  };
  const command = (action: string) => {
    setMenu(null);
    if (action === 'new') newDocument();
    else if (action === 'open') void open();
    else if (action === 'save') void save();
    else if (action === 'copy') copy();
    else if (action === 'paste') paste();
    else if (action === 'duplicate') duplicate();
    else if (action === 'undo' || action === 'redo') restore(action);
    else if (action === 'delete') setPendingDelete(true);
    else if (action === 'group') group('container');
    else if (action === 'ungroup') commit({ ...current(), nodes: ungroupNodes(nodes, selectedIds) });
    else if (action === 'fit') void fitView({ padding: .2 });
    else if (action === 'grid') setShowGrid(!showGrid);
    else if (action === 'snap') setSnap(!snap);
    else if (action === 'horizontal' || action === 'vertical') layoutPage(action);
    else if (action === 'help') setHelp(true);
    else arrange(action);
  };
  const menuItems: Record<string, [string, string][]> = {
    文件: [['new', '新建'], ['open', '打开'], ['save', '保存']],
    编辑: [['undo', '撤销'], ['redo', '重做'], ['copy', '复制'], ['paste', '粘贴'], ['duplicate', '创建副本'], ['delete', '删除']],
    查看: [['fit', '适应画布'], ['grid', '切换网格'], ['snap', '切换吸附']],
    排列: [['left', '左对齐'], ['right', '右对齐'], ['top', '顶对齐'], ['bottom', '底对齐'], ['horizontal', '水平自动布局'], ['vertical', '垂直自动布局'], ['group', '组合'], ['ungroup', '取消组合']],
  };
  const keyHandler = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
    const ctrl = event.ctrlKey || event.metaKey; const key = event.key.toLowerCase();
    if (event.key === 'Escape') { setMenu(null); setTool('select'); return; }
    if (ctrl && ['s', 'z', 'y', 'c', 'v', 'd', 'a', 'g'].includes(key)) {
      event.preventDefault();
      if (key === 's') void save();
      if (key === 'z') restore(event.shiftKey ? 'redo' : 'undo');
      if (key === 'y') restore('redo');
      if (key === 'c') copy();
      if (key === 'v') paste();
      if (key === 'd') duplicate();
      if (key === 'g') command(event.shiftKey ? 'ungroup' : 'group');
      if (key === 'a') send({ type: 'preview', document: { ...current(), nodes: nodes.map((node) => ({ ...node, selected: editableIds.has(node.id) })) } });
    } else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (selectedIds.length || selectedEdges.length) setPendingDelete(true); }
    else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selectedIds.length) {
      event.preventDefault(); const amount = event.shiftKey ? 10 : 1;
      commit({ ...current(), nodes: nodes.map((node) => !node.selected ? node : { ...node, position: { x: node.position.x + (event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0), y: node.position.y + (event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0) } }) });
    }
  };
  const marker = (value: string | undefined) => value === 'arrow' ? { type: MarkerType.Arrow } : value === 'closed-arrow' ? { type: MarkerType.ArrowClosed } : undefined;
  const definitions = getFlowNodeDefinitions().filter((definition) => definition.label.includes(search) || definition.type.includes(search.toLowerCase()));
  const renderedEdges = edges.filter((edge) => availableIds.has(edge.source) && availableIds.has(edge.target)).map((edge) => ({
    ...edge, type: 'flow-edge', markerStart: marker(edge.data?.startMarker), markerEnd: marker(edge.data?.endMarker ?? 'closed-arrow'),
  }));
  return <section ref={root} tabIndex={0} onKeyDown={keyHandler} className={'flow-board flex h-full min-h-0 flex-col' + (tool === 'connect' ? ' flow-connect-mode' : '')}>
    <header className="flow-topbar"><div className="flow-brand"><div className="flow-brand-mark">N</div><div><strong>Niuery Draw</strong><span>{path?.split(/[\\/]/).pop() ?? '未命名流程图'}{dirty ? ' ·' : ''}</span></div></div>
      <nav className="flow-menu-row">{Object.keys(menuItems).map((name) => <div key={name} className="flow-menu-anchor"><button className="flow-menu" aria-expanded={menu === name} onClick={() => setMenu(menu === name ? null : name)}>{name}</button>{menu === name && <div role="menu" className="flow-dropdown">{menuItems[name].map(([action, label]) => <button key={action} role="menuitem" onClick={() => command(action)}>{label}</button>)}</div>}</div>)}</nav>
      <button className="flow-help-button" onClick={() => setHelp(true)}>快捷键</button>
    </header>
    <div className="flow-toolbar">
      <button title="新建" aria-label="新建" className="flow-tool-btn" onClick={newDocument}><FilePlus2 size={17} /></button>
      <button title="打开" aria-label="打开" className="flow-tool-btn" onClick={() => void open()}><FolderOpen size={17} /></button>
      <button title="保存" aria-label="保存" className="flow-tool-btn" onClick={() => void save()}><Save size={17} /></button><span className="flow-divider" />
      <button title="撤销" aria-label="撤销" className="flow-tool-btn" disabled={!state.past.length} onClick={() => restore('undo')}><Undo2 size={17} /></button>
      <button title="重做" aria-label="重做" className="flow-tool-btn" disabled={!state.future.length} onClick={() => restore('redo')}><Redo2 size={17} /></button><span className="flow-divider" />
      <button title="选择" aria-label="选择" className={'flow-tool-btn ' + (tool === 'select' ? 'active' : '')} onClick={() => setTool('select')}><MousePointer2 size={17} /></button>
      <button title="连接" aria-label="连接" className={'flow-tool-btn ' + (tool === 'connect' ? 'active' : '')} onClick={() => setTool('connect')}><Waypoints size={17} /></button>
      <button title="创建副本" aria-label="创建副本" className="flow-tool-btn" disabled={!selectedIds.length} onClick={duplicate}><Copy size={17} /></button>
      <button title="删除" aria-label="删除" className="flow-tool-btn" disabled={!selectedIds.length && !selectedEdges.length} onClick={() => setPendingDelete(true)}><Trash2 size={17} /></button>
      <button title="水平自动布局" aria-label="水平自动布局" className="flow-tool-btn" onClick={() => layoutPage('horizontal')}><Layout size={17} /></button>
      <button className="flow-text-btn" onClick={() => group('container')}>组合</button><button className="flow-text-btn" onClick={() => group('swimlane')}>泳道</button>
      <button className="flow-text-btn" disabled={!selectedNodes.some((node) => node.data.containerType)} onClick={() => command('ungroup')}>取消组合</button>
      <span className="flow-toolbar-spacer" />
      <button className="flow-text-btn" onClick={() => { setSourceDialog(true); setPendingImport(null); setSourceError(''); }}>从文本生成</button>
      <div className="flow-menu-anchor"><button aria-label="导出" className="flow-export-btn" onClick={() => setMenu(menu === 'export' ? null : 'export')}><Download size={15} />导出</button>{menu === 'export' && <div className="flow-dropdown" role="menu">{[['json', 'JSON'], ['svg', 'SVG'], ['png', 'PNG'], ['pdf', 'PDF'], ['html', 'HTML'], ['url', 'URL'], ['mermaid', 'Mermaid'], ['csv', 'CSV'], ['drawio', 'draw.io XML']].map(([format, label]) => <button key={format} role="menuitem" onClick={() => void exportFile(format)}>{label}</button>)}</div>}</div>
    </div>
    <div className="flow-main min-h-0 flex-1">
      <aside className="flow-sidebar"><label className="flow-sidebar-search"><Search size={15} /><input placeholder="搜索图形" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <div className="flow-sidebar-section"><h3 className="flow-section-title">标准流程图</h3>{definitions.map((definition) => <button aria-label={'添加 ' + definition.label} key={definition.type} className="flow-shape-item" draggable onDragStart={(e) => e.dataTransfer.setData('application/flow-node', definition.type)} onClick={() => addNode(definition.type)}><span className="flow-shape-preview"><svg width="32" height="28" viewBox={'-3 -3 ' + (definition.createDefaultData().width + 6) + ' ' + (definition.createDefaultData().height + 6)}>{getPreviewPaths(definition.type)}</svg></span>{definition.label}<Plus size={12} /></button>)}</div>
        <div className="flow-sidebar-section"><h3 className="flow-section-title">模板</h3>{FLOW_TEMPLATES.map((template) => <button className="flow-shape-item" key={template.id} title={template.description} onClick={() => { if (dirty && !window.confirm('替换当前流程图？可以撤销。')) return; commit(template.create()); setPath(null); requestAnimationFrame(() => void fitView()); }}>{template.name}</button>)}</div>
        <div className="flow-sidebar-footer"><button onClick={newPage}><Plus size={15} />新建页面</button><button onClick={() => void open()}><FolderOpen size={15} />导入文件</button></div>
      </aside>
      <div className="flow-canvas" onDrop={(event) => { event.preventDefault(); const type = event.dataTransfer.getData('application/flow-node'); if (type) addNode(type, screenToFlowPosition({ x: event.clientX, y: event.clientY })); }} onDragOver={(e) => e.preventDefault()}>
        <CanvasActionsContext.Provider value={actions}><ReactFlow<FlowNode, FlowEdge> key={document.activePageId} nodes={projectedNodes} edges={renderedEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} connectionMode={ConnectionMode.Loose}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={connect} onReconnect={(_edge, connection) => { const doc = current(); commit({ ...doc, edges: doc.edges.map((edge) => edge.id === _edge.id ? { ...edge, ...connection, data: { ...edge.data, waypoints: [] } } : edge) }); }}
          onNodeDragStart={begin} onNodeDragStop={finish} onSelectionDragStart={begin} onSelectionDragStop={finish}
          onNodeClick={() => setInspector('format')} onEdgeClick={() => setInspector('format')}
          onMoveEnd={(_, viewport) => { send({ type: 'preview', document: { ...current(), viewport } }); setZoom(Math.round(viewport.zoom * 100)); }}
          connectionLineType={ConnectionLineType.SmoothStep} deleteKeyCode={null} nodesDraggable={tool !== 'connect'} nodesConnectable edgesReconnectable
          snapToGrid={snap} snapGrid={[10, 10]} selectionOnDrag panOnDrag={[1, 2]} defaultViewport={document.viewport} minZoom={.1} maxZoom={4} fitView>
          {showGrid && <Background variant={BackgroundVariant.Lines} gap={20} size={1} color="#d7dce3" />}
          <MiniMap pannable zoomable className="flow-minimap" />
          <Panel position="top-right" className="flow-canvas-tools"><button title="适应画布" aria-label="适应画布" onClick={() => void fitView({ padding: .2 })}><Maximize2 size={15} /></button><button title="网格" aria-label="网格" onClick={() => setShowGrid(!showGrid)}><Grid3X3 size={15} /></button></Panel>
          <Panel position="bottom-center" className="flow-zoom-controls"><button aria-label="缩小" onClick={() => void zoomOut()}><Minus size={14} /></button>{zoom}%<button aria-label="放大" onClick={() => void zoomIn()}><Plus size={14} /></button></Panel>
        </ReactFlow></CanvasActionsContext.Provider>
      </div>
      <aside className="flow-inspector"><div role="tablist" className="flow-inspector-tabs"><button role="tab" aria-selected={inspector === 'format'} onClick={() => setInspector('format')}>格式</button><button role="tab" aria-selected={inspector === 'layers'} onClick={() => setInspector('layers')}>图层</button></div>
        {inspector === 'format' ? <FlowInspector node={selectedNode} edge={selectedEdge} page={page} count={selectedIds.length} begin={begin} finish={finish} arrange={arrange}
          updateNode={(patch) => { for (const id of selectedIds) updateNode(id, patch); }} updateEdge={(patch) => { for (const edge of selectedEdges) updateEdge(edge.id, patch); }} />
          : <div role="tabpanel" aria-label="图层" className="flow-inspector-body"><h3>页面图层</h3>{page.layers.map((layer) => <div className="flow-layer-item" key={layer.id}><strong>{layer.name}</strong><label><input type="checkbox" aria-label={'显示 ' + layer.name} checked={layer.visible} onChange={(e) => setLayer(layer.id, { visible: e.target.checked })} />显示</label><label><input type="checkbox" aria-label={'锁定 ' + layer.name} checked={layer.locked} onChange={(e) => setLayer(layer.id, { locked: e.target.checked })} />锁定</label><button onClick={() => { const name = window.prompt('图层名称', layer.name); if (name?.trim()) setLayer(layer.id, { name: name.trim() }); }}>重命名</button></div>)}<button onClick={addLayer}>新增图层</button></div>}
      </aside>
    </div>
    <footer className="flow-statusbar"><span>{dirty ? '有未保存更改' : path ? '已保存' : '未保存文件'}</span><span>{nodes.length} 个图形 · {edges.length} 条连接</span><div role="tablist" aria-label="页面" className="flow-page-tabs">{document.pages.map((item) => <button role="tab" aria-selected={item.id === document.activePageId} key={item.id} onClick={() => switchPage(item.id)}>{item.name}</button>)}</div><button onClick={renamePage}>页面重命名</button><button disabled={document.pages.length < 2} onClick={deletePage}>删除页面</button><button onClick={() => setSnap(!snap)}>{snap ? '吸附已开启' : '吸附已关闭'}</button></footer>
    <input ref={fileInput} aria-label="打开流程图文件" className="hidden" type="file" accept=".json,.mmd,.mermaid,.csv,.sql,.drawio,.xml" onChange={(e) => { const file = e.target.files?.[0]; if (file) void loadFile(file); e.target.value = ''; }} />
    {sourceDialog && <div className="flow-modal-backdrop"><div className="flow-dialog" role="dialog" aria-modal="true" aria-label="从文本生成流程图"><h2>从文本生成流程图</h2><div className="flow-dialog-actions"><label>格式<select value={sourceKind} onChange={(e) => { setSourceKind(e.target.value as ImportKind); setPendingImport(null); }}>{[['mermaid', 'Mermaid 流程图'], ['csv', 'CSV 节点与连接'], ['sql', 'SQL 表关系'], ['json', '结构化 JSON'], ['xml', 'draw.io XML']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button onClick={async () => { try { await navigator.clipboard.writeText(FLOW_AI_PROMPT); setCopiedPrompt(true); window.setTimeout(() => setCopiedPrompt(false), 1800); } catch { setSourceError('复制 AI 提示词失败'); } }}>{copiedPrompt ? '已复制' : '复制 AI 提示词'}</button></div><textarea aria-label="生成源码" value={source} onChange={(e) => { setSource(e.target.value); setPendingImport(null); }} /><p className="flow-help">可直接粘贴 Mermaid/CSV/SQL/XML，或让 AI 按结构化 JSON 提示词生成后粘贴。先预览，再替换当前文档；替换后可以撤销。</p>{sourceError && <p role="alert">{sourceError}</p>}{pendingImport && <p role="status">识别到 {pendingImport.nodes.length} 个图形、{pendingImport.edges.length} 条连接</p>}<footer><button onClick={() => setSourceDialog(false)}>取消</button><button onClick={() => { try { setPendingImport(parseSource(source, sourceKind)); setSourceError(''); } catch (error) { setSourceError(String(error)); } }}>预览</button><button disabled={!pendingImport} onClick={() => { if (!pendingImport) return; commit(pendingImport); setPath(null); setSourceDialog(false); requestAnimationFrame(() => void fitView()); }}>确认替换</button></footer></div></div>}
    {pendingDelete && <div className="flow-modal-backdrop"><div className="flow-dialog flow-dialog-small" role="dialog" aria-modal="true" aria-label="删除所选内容"><h2>删除所选内容？</h2><p>关联连接线会一并删除，可通过撤销恢复。</p><footer><button onClick={() => setPendingDelete(false)}>取消</button><button onClick={deleteSelection}>确认删除</button></footer></div></div>}
    {help && <div className="flow-modal-backdrop"><div className="flow-dialog flow-dialog-small" role="dialog" aria-modal="true" aria-label="流程图快捷键"><h2>流程图快捷键</h2><p>Ctrl+S 保存 · Ctrl+Z 撤销 · Ctrl+Y 重做</p><p>Ctrl+C/V 复制粘贴 · Ctrl+D 创建副本</p><p>Ctrl+G 组合 · Ctrl+Shift+G 取消组合</p><p>Shift 多选 · 方向键微调 · Delete 删除</p><p>双击节点编辑文字；双击连接线添加控制点。右键或中键拖动画布。</p><button onClick={() => setHelp(false)}>关闭</button></div></div>}
  </section>;
}

import { getNodeShape } from './geometry';
function getPreviewPaths(type: string) {
  const data = getFlowNodeDefinitions().find((definition) => definition.type === type)!.createDefaultData();
  return getNodeShape(data).paths.map((path, index) => <path key={index} d={path} fill={index === 0 ? '#edf4ff' : 'none'} stroke="#526173" strokeWidth={5} />);
}
export default function FlowBoard() { return <ReactFlowProvider><FlowBoardInner /></ReactFlowProvider>; }
