import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, FileImage, FilePlus2, FolderOpen, Library, Link2, MousePointer2, Plus, Redo2, Save, Undo2, ZoomIn } from 'lucide-react';
import { Arrow, Group, Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveBytes } from '@/lib/file-save';
import { isTauri } from '@/lib/api-client';
import { saveCanvasDocument, readCanvasAsset } from '@/lib/canvas-document-file';
import {
  discardRecoverySnapshot,
  listRecoverySnapshots,
  openConfirmedLocalFile,
  openTextDocument,
  writeRecoverySnapshot,
  type RecoverySnapshot,
} from '@/lib/local-documents';
import {
  createKnowledgeCanvas,
  createKnowledgeCanvasTemplate,
  knowledgeCanvasBounds,
  knowledgeCanvasToSvg,
  parseKnowledgeCanvas,
  prepareCanvasSave,
  type CanvasNode,
  type KnowledgeCanvasDocument,
} from './model';

const TOOL_ID = 'knowledge-canvas';

function newId(prefix: string) {
  const value = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${value}`;
}

function documentName(path: string | null, fallback: string) {
  return path?.split(/[\\/]/).pop() ?? fallback;
}

function CanvasImage({ node }: { node: CanvasNode }) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!node.image?.source.startsWith('data:')) {
      setImage(null);
      return;
    }
    const element = new Image();
    element.onload = () => setImage(element);
    element.src = node.image.source;
    return () => { element.onload = null; };
  }, [node.image?.source]);
  if (!image) return null;
  return <KonvaImage image={image} x={12} y={48} width={node.width - 24} height={node.height - 60} opacity={0.9} />;
}

export default function KnowledgeCanvasTool() {
  const { t, i18n } = useTranslation();
  const stageRef = useRef<Konva.Stage>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const recoveryId = useRef(newId('recovery'));
  const undoStack = useRef<KnowledgeCanvasDocument[]>([]);
  const redoStack = useRef<KnowledgeCanvasDocument[]>([]);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [document, setDocument] = useState<KnowledgeCanvasDocument>(() => createKnowledgeCanvas(locale));
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ width: 960, height: 640 });
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);

  const selected = document.nodes.find((node) => node.id === selectedId) ?? null;
  const templates = useMemo(() => [
    {
      id: 'problem', label: t('knowledgeCanvas.templateProblem'), description: t('knowledgeCanvas.templateProblemDesc'),
      document: createKnowledgeCanvasTemplate('problem', locale),
    },
    {
      id: 'research', label: t('knowledgeCanvas.templateResearch'), description: t('knowledgeCanvas.templateResearchDesc'),
      document: createKnowledgeCanvasTemplate('research', locale),
    },
  ], [locale, t]);

  const commit = useCallback((updater: (current: KnowledgeCanvasDocument) => KnowledgeCanvasDocument) => {
    setDocument((current) => {
      undoStack.current.push(structuredClone(current));
      if (undoStack.current.length > 80) undoStack.current.shift();
      redoStack.current = [];
      return updater(current);
    });
    setDirty(true);
  }, []);

  const loadDocument = useCallback((next: KnowledgeCanvasDocument, path: string | null) => {
    setDocument(next);
    setDocumentPath(path);
    setSelectedId(null);
    setConnectingFrom(null);
    setDirty(false);
    undoStack.current = [];
    redoStack.current = [];
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    void listRecoverySnapshots(TOOL_ID).then(setRecoverySnapshots).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const timeout = window.setTimeout(() => {
      void writeRecoverySnapshot(TOOL_ID, recoveryId.current, JSON.stringify(document), documentPath).catch(() => undefined);
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [document, documentPath, dirty]);

  const addTextCard = useCallback(() => {
    const id = newId('card');
    commit((current) => ({
      ...current,
      nodes: [...current.nodes, {
        id,
        x: 180 + (current.nodes.length % 4) * 42,
        y: 150 + (current.nodes.length % 4) * 42,
        width: 220,
        height: 128,
        text: t('knowledgeCanvas.newCard'),
        note: '',
        tags: [],
        color: '#2563eb',
      }],
    }));
    setSelectedId(id);
  }, [commit, t]);

  const updateNode = useCallback((id: string, patch: Partial<CanvasNode>) => {
    commit((current) => ({
      ...current,
      nodes: current.nodes.map((node) => node.id === id ? { ...node, ...patch } : node),
    }));
  }, [commit]);

  const selectCard = useCallback((id: string) => {
    if (!connectingFrom) {
      setSelectedId(id);
      return;
    }
    if (connectingFrom !== id) {
      const edgeId = `${connectingFrom}-${id}`;
      commit((current) => current.edges.some((edge) => edge.from === connectingFrom && edge.to === id)
        ? current
        : { ...current, edges: [...current.edges, { id: edgeId, from: connectingFrom, to: id, directed: true }] });
    }
    setConnectingFrom(null);
  }, [commit, connectingFrom]);

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    setDocument((current) => {
      redoStack.current.push(structuredClone(current));
      return previous;
    });
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    setDocument((current) => {
      undoStack.current.push(structuredClone(current));
      return next;
    });
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    const prepared = prepareCanvasSave(document);
    const path = await saveCanvasDocument(prepared.content, prepared.assets, documentName(documentPath, t('knowledgeCanvas.unnamed')));
    if (!path) return;
    setDocumentPath(path);
    setDirty(false);
    await discardRecoverySnapshot(TOOL_ID, recoveryId.current).catch(() => undefined);
    toast.success(t('knowledgeCanvas.saved'));
  }, [document, documentPath, t]);

  const hydrateAssets = useCallback(async (next: KnowledgeCanvasDocument, path: string | null) => {
    if (!path) return next;
    const nodes = await Promise.all(next.nodes.map(async (node) => {
      if (!node.image?.source || node.image.source.startsWith('data:')) return node;
      try {
        return { ...node, image: { ...node.image, source: await readCanvasAsset(path, node.image.source) } };
      } catch {
        return { ...node, note: [node.note, t('knowledgeCanvas.unreadableImage')].filter(Boolean).join('\n'), image: undefined };
      }
    }));
    return { ...next, nodes };
  }, [t]);

  const openSource = useCallback(async (source: string, path: string | null) => {
    try {
      const parsed = parseKnowledgeCanvas(source);
      loadDocument(await hydrateAssets(parsed, path), path);
      toast.success(t('knowledgeCanvas.opened'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('knowledgeCanvas.openFailed'));
    }
  }, [hydrateAssets, loadDocument, t]);

  const open = useCallback(async () => {
    if (dirty && !window.confirm(t('knowledgeCanvas.unsavedOpen'))) return;
    if (isTauri) {
      const result = await openTextDocument(t('tools.knowledge-canvas'), ['niuery-canvas']);
      if (result) await openSource(result.contents, result.path);
      return;
    }
    fallbackInputRef.current?.click();
  }, [dirty, openSource, t]);

  const startNew = useCallback(() => {
    if (dirty && !window.confirm(t('knowledgeCanvas.unsavedNew'))) return;
    recoveryId.current = newId('recovery');
    loadDocument(createKnowledgeCanvas(locale), null);
  }, [dirty, loadDocument, locale, t]);

  const exportPng = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = knowledgeCanvasBounds(document);
    const position = stage.position();
    const scale = stage.scale();
    stage.position({ x: 0, y: 0 });
    stage.scale({ x: 1, y: 1 });
    const dataUrl = stage.toDataURL({ ...bounds, pixelRatio: 2, mimeType: 'image/png' });
    stage.position(position);
    stage.scale(scale);
    stage.batchDraw();
    if (!dataUrl) return;
    await saveBytes('知识画布.png', await fetch(dataUrl).then((response) => response.blob()), 'PNG', ['png']);
  }, [document]);

  const exportSvg = useCallback(async () => {
    await saveBytes('知识画布.svg', new Blob([knowledgeCanvasToSvg(document)], { type: 'image/svg+xml' }), 'SVG', ['svg']);
  }, [document]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editingText = target?.matches('input, textarea, [contenteditable="true"]');
      if (editingText) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (event.key === 'Delete' && selectedId) {
        commit((current) => ({
          ...current,
          nodes: current.nodes.filter((node) => node.id !== selectedId),
          edges: current.edges.filter((edge) => edge.from !== selectedId && edge.to !== selectedId),
        }));
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commit, redo, save, selectedId, undo]);

  const edgePairs = useMemo(() => {
    const byId = new Map(document.nodes.map((node) => [node.id, node]));
    return document.edges.flatMap((edge) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      return from && to ? [{ edge, from, to }] : [];
    });
  }, [document]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/80 bg-card/40 px-3 py-2">
        <Button variant="ghost" size="sm" onClick={startNew}><FilePlus2 className="mr-1.5 h-4 w-4" />{t('knowledgeCanvas.new')}</Button>
        <Button variant="ghost" size="sm" onClick={() => void open()}><FolderOpen className="mr-1.5 h-4 w-4" />{t('knowledgeCanvas.open')}</Button>
        <Button variant="ghost" size="sm" onClick={() => void save()}><Save className="mr-1.5 h-4 w-4" />{t('knowledgeCanvas.save')}{dirty ? ' •' : ''}</Button>
        <Button variant={templatesOpen ? 'secondary' : 'ghost'} size="sm" onClick={() => setTemplatesOpen((value) => !value)}><Library className="mr-1.5 h-4 w-4" />{t('knowledgeCanvas.template')}</Button>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button variant="ghost" size="sm" onClick={addTextCard}><Plus className="mr-1.5 h-4 w-4" />{t('knowledgeCanvas.card')}</Button>
        <Button variant={connectingFrom ? 'secondary' : 'ghost'} size="sm" onClick={() => setConnectingFrom((value) => value ? null : selectedId)} disabled={!selectedId && !connectingFrom}>
          <Link2 className="mr-1.5 h-4 w-4" />{connectingFrom ? t('knowledgeCanvas.selectTarget') : t('knowledgeCanvas.connect')}
        </Button>
        <Button variant="ghost" size="icon" onClick={undo} title={t('knowledgeCanvas.undo')}><Undo2 className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" onClick={redo} title={t('knowledgeCanvas.redo')}><Redo2 className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" onClick={() => setViewport({ x: 0, y: 0, scale: 1 })} title={t('knowledgeCanvas.resetView')}><ZoomIn className="h-4 w-4" /></Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void exportPng()}><FileImage className="mr-1.5 h-4 w-4" />PNG</Button>
          <Button variant="ghost" size="sm" onClick={() => void exportSvg()}><FileImage className="mr-1.5 h-4 w-4" />SVG</Button>
        </div>
      </div>
      {templatesOpen && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/80 bg-card/30 px-3 py-2">
        <span className="text-sm text-muted-foreground">{t('knowledgeCanvas.templatePrompt')}</span>
        {templates.map((template) => <Button key={template.id} variant="outline" size="sm" onClick={() => {
          if (dirty && !window.confirm(t('knowledgeCanvas.unsavedNew'))) return;
          recoveryId.current = newId('recovery');
          loadDocument(structuredClone(template.document), null);
          setDirty(true);
          setTemplatesOpen(false);
        }}>{template.label} · {template.description}</Button>)}
      </div>}
      {recoverySnapshots.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/25 bg-warning/10 px-3 py-2 text-sm">
          <span className="flex-1 text-warning">{t('knowledgeCanvas.drafts', { count: recoverySnapshots.length })}</span>
          {recoverySnapshots.slice(0, 3).map((snapshot) => <Button key={snapshot.id} size="sm" variant="outline" onClick={() => {
            try {
              loadDocument(parseKnowledgeCanvas(snapshot.content), snapshot.document_path);
              recoveryId.current = snapshot.id;
              setDirty(true);
              setRecoverySnapshots((items) => items.filter((item) => item.id !== snapshot.id));
            } catch { toast.error(t('knowledgeCanvas.damagedDraft')); }
          }}>{t('knowledgeCanvas.restore')}</Button>)}
          <Button size="sm" variant="ghost" onClick={() => {
            recoverySnapshots.forEach((snapshot) => void discardRecoverySnapshot(TOOL_ID, snapshot.id));
            setRecoverySnapshots([]);
          }}>{t('knowledgeCanvas.discardAll')}</Button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div ref={viewportRef} className="relative min-h-0 flex-1 overflow-hidden bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:20px_20px]">
          <Stage
            ref={stageRef}
            width={size.width}
            height={size.height}
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
            draggable
            onDragEnd={(event) => {
              if (event.target !== event.target.getStage()) return;
              setViewport((current) => ({ ...current, x: event.target.x(), y: event.target.y() }));
            }}
            onWheel={(event) => {
              event.evt.preventDefault();
              const stage = event.target.getStage();
              const pointer = stage?.getPointerPosition();
              if (!stage || !pointer) return;
              const oldScale = viewport.scale;
              const scale = Math.max(0.3, Math.min(2.4, event.evt.deltaY > 0 ? oldScale / 1.08 : oldScale * 1.08));
              const point = { x: (pointer.x - viewport.x) / oldScale, y: (pointer.y - viewport.y) / oldScale };
              setViewport({ scale, x: pointer.x - point.x * scale, y: pointer.y - point.y * scale });
            }}
            onMouseDown={(event) => { if (event.target === event.target.getStage()) setSelectedId(null); }}
          >
            <Layer>
              {edgePairs.map(({ edge, from, to }) => <Arrow key={edge.id} points={[from.x + from.width / 2, from.y + from.height / 2, to.x + to.width / 2, to.y + to.height / 2]} stroke="#64748b" fill="#64748b" pointerLength={edge.directed ? 9 : 0} pointerWidth={edge.directed ? 9 : 0} strokeWidth={2} />)}
              {document.nodes.map((node) => (
                <Group
                  key={node.id}
                  x={node.x}
                  y={node.y}
                  draggable
                  onClick={(event) => { event.cancelBubble = true; selectCard(node.id); }}
                  onDblClick={(event) => {
                    event.cancelBubble = true;
                    const text = window.prompt(t('knowledgeCanvas.cardTitle'), node.text);
                    if (text !== null) updateNode(node.id, { text });
                  }}
                  onDragEnd={(event) => updateNode(node.id, { x: event.target.x(), y: event.target.y() })}
                >
                  <Rect width={node.width} height={node.height} cornerRadius={12} fill="hsl(var(--card))" stroke={selectedId === node.id ? 'hsl(var(--primary))' : node.color} strokeWidth={selectedId === node.id ? 4 : 2} shadowColor="black" shadowBlur={8} shadowOpacity={0.12} shadowOffsetY={3} />
                  <Rect width={7} height={node.height} cornerRadius={3} fill={node.color} />
                  <Text x={16} y={15} width={node.width - 32} text={node.text} fontSize={16} fontStyle="bold" fill="hsl(var(--foreground))" ellipsis />
                  <Text x={16} y={42} width={node.width - 32} height={node.image ? 0 : 54} text={node.note} fontSize={12} lineHeight={1.4} fill="hsl(var(--muted-foreground))" ellipsis />
                  <CanvasImage node={node} />
                  {node.filePath && <Text x={16} y={node.height - 21} text={t('knowledgeCanvas.localFile')} fontSize={11} fill={node.color} />}
                </Group>
              ))}
            </Layer>
          </Stage>
        </div>
        <aside className="w-72 shrink-0 overflow-y-auto border-l border-border/80 bg-card/35 p-3">
          {selected ? <div className="space-y-4">
            <div><p className="text-sm font-semibold">{t('knowledgeCanvas.properties')}</p><p className="mt-1 text-xs text-muted-foreground">{t('knowledgeCanvas.propertiesHint')}</p></div>
            <label className="block text-xs font-medium text-muted-foreground">{t('knowledgeCanvas.title')}<Input className="mt-1" value={selected.text} onChange={(event) => updateNode(selected.id, { text: event.target.value })} /></label>
            <label className="block text-xs font-medium text-muted-foreground">{t('knowledgeCanvas.note')}<textarea className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={selected.note} onChange={(event) => updateNode(selected.id, { note: event.target.value })} /></label>
            <label className="block text-xs font-medium text-muted-foreground">{t('knowledgeCanvas.tags')}<Input className="mt-1" value={selected.tags.join(', ')} onChange={(event) => updateNode(selected.id, { tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></label>
            <label className="block text-xs font-medium text-muted-foreground">{t('knowledgeCanvas.color')}<Input className="mt-1 h-9 p-1" type="color" value={selected.color} onChange={(event) => updateNode(selected.id, { color: event.target.value })} /></label>
            <label className="block text-xs font-medium text-muted-foreground">{t('knowledgeCanvas.filePath')}<Input className="mt-1" value={selected.filePath ?? ''} placeholder={t('knowledgeCanvas.filePathPlaceholder')} onChange={(event) => updateNode(selected.id, { filePath: event.target.value || undefined })} /></label>
            {selected.filePath && <Button variant="outline" className="w-full" onClick={() => {
              const filePath = selected.filePath;
              if (!filePath || !window.confirm(`${t('knowledgeCanvas.openLocalConfirm')}\n${filePath}`)) return;
              void openConfirmedLocalFile(filePath).catch((error) => toast.error(error instanceof Error ? error.message : t('knowledgeCanvas.openLocalFailed')));
            }}><ArrowRight className="mr-1.5 h-4 w-4" />{t('knowledgeCanvas.openLocal')}</Button>}
            <Button variant="outline" className="w-full" onClick={() => imageInputRef.current?.click()}><FileImage className="mr-1.5 h-4 w-4" />{t('knowledgeCanvas.replaceImage')}</Button>
            <Button variant="destructive" className="w-full" onClick={() => {
              commit((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== selected.id), edges: current.edges.filter((edge) => edge.from !== selected.id && edge.to !== selected.id) }));
              setSelectedId(null);
            }}>{t('knowledgeCanvas.deleteCard')}</Button>
          </div> : <div className="space-y-2 text-sm text-muted-foreground"><MousePointer2 className="h-5 w-5" /><p>{t('knowledgeCanvas.emptySelection')}</p></div>}
        </aside>
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-border/80 px-3 py-1.5 text-xs text-muted-foreground"><span>{documentName(documentPath, t('knowledgeCanvas.unnamed'))}{dirty ? t('knowledgeCanvas.unsaved') : ''}</span><span>{connectingFrom ? t('knowledgeCanvas.connectingHint') : t('knowledgeCanvas.hint')}</span></div>
      <input ref={fallbackInputRef} className="hidden" type="file" accept=".niuery-canvas,application/json" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void file.text().then((source) => openSource(source, file.name));
        event.currentTarget.value = '';
      }} />
      <input ref={imageInputRef} className="hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file && selectedId) {
          const reader = new FileReader();
          reader.onload = () => updateNode(selectedId, { image: { source: String(reader.result), mimeType: file.type || 'image/png' } });
          reader.readAsDataURL(file);
        }
        event.currentTarget.value = '';
      }} />
    </section>
  );
}
