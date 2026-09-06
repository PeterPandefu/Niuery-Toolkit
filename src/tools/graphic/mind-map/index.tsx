import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FilePlus2, FolderOpen, Library, Plus, Redo2, Save, Undo2, ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { saveBytes, saveBytesWithFeedback } from '@/lib/file-save';
import {
  discardRecoverySnapshot,
  listRecoverySnapshots,
  openBinaryDocument,
  writeRecoverySnapshot,
  type RecoverySnapshot,
} from '@/lib/local-documents';
import { isTauri } from '@/lib/api-client';
import { MindMapSurface, type MindMapSurfaceHandle } from './MindMapSurface';
import {
  createMindMapDocument,
  mindMapToMarkdown,
  markdownToMindMap,
  parseMindMapDocument,
  parseXMindDocument,
  type MindMapDocument,
} from './document';

const TOOL_ID = 'mind-map';

const LAYOUTS = [
  { value: 'logicalStructure', key: 'layoutLogical' },
  { value: 'mindMap', key: 'layoutMindMap' },
  { value: 'organizationStructure', key: 'layoutOrganization' },
] as const;

const APPEARANCES = [
  { value: 'default', key: 'appearanceDefault', config: {} },
  {
    value: 'contrast',
    key: 'appearanceContrast',
    config: {
      backgroundColor: '#172033',
      lineColor: '#7dd3fc',
      root: { fillColor: '#0369a1' },
      second: { fillColor: '#24324a', color: '#e2e8f0', borderColor: '#7dd3fc' },
      node: { color: '#cbd5e1' },
    },
  },
] as const;

function createRecoveryId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function filenameFromPath(path: string | null, fallback: string, extension: string) {
  if (!path) return `${fallback.replace(/[\\/:*?"<>|]/g, '-').slice(0, 48) || '未命名'}${extension}`;
  return path.split(/[\\/]/).pop() ?? `${fallback}${extension}`;
}

function findNodeByUid(node: MindMapDocument['root'], uid: string): MindMapDocument['root'] | null {
  if (node.data.uid === uid) return node;
  for (const child of node.children) {
    const match = findNodeByUid(child, uid);
    if (match) return match;
  }
  return null;
}

export default function MindMapTool() {
  const { t } = useTranslation();
  const surfaceRef = useRef<MindMapSurfaceHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const recoveryId = useRef(createRecoveryId());
  const [document, setDocument] = useState<MindMapDocument>(() => createMindMapDocument(t('mindMap.unnamed')));
  const [documentVersion, setDocumentVersion] = useState(0);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInfo, setSearchInfo] = useState({ currentIndex: -1, total: 0 });
  const [focusedUid, setFocusedUid] = useState<string | null>(null);

  const title = useMemo(() => String(document.root.data.text || t('mindMap.unnamed')), [document, t]);
  const templates = useMemo(() => [
    {
      id: 'project',
      label: t('mindMap.templateProject'),
      description: t('mindMap.templateProjectDesc'),
      document: {
        root: { data: { text: t('mindMap.templateProject') }, children: [
          { data: { text: '目标' }, children: [{ data: { text: '成功标准' }, children: [] }] },
          { data: { text: '里程碑' }, children: [{ data: { text: '第一阶段' }, children: [] }, { data: { text: '发布' }, children: [] }] },
          { data: { text: '风险' }, children: [{ data: { text: '应对方案' }, children: [] }] },
        ] },
        layout: 'logicalStructure', theme: { template: 'default', config: {} },
      } satisfies MindMapDocument,
    },
    {
      id: 'reading',
      label: t('mindMap.templateReading'),
      description: t('mindMap.templateReadingDesc'),
      document: {
        root: { data: { text: t('mindMap.templateReading') }, children: [
          { data: { text: '书目信息' }, children: [] },
          { data: { text: '核心观点' }, children: [{ data: { text: '引用或摘要' }, children: [] }] },
          { data: { text: '证据与反思' }, children: [] },
          { data: { text: '行动' }, children: [{ data: { text: '下一步' }, children: [] }] },
        ] },
        layout: 'logicalStructure', theme: { template: 'default', config: {} },
      } satisfies MindMapDocument,
    },
  ], [t]);

  const loadDocument = useCallback((next: MindMapDocument, path: string | null = null) => {
    setDocument(next);
    setDocumentPath(path);
    setDocumentVersion((value) => value + 1);
    setDirty(false);
    setFocusedUid(null);
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

  const handleChange = useCallback((next: MindMapDocument) => {
    setDocument(next);
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    const path = await saveBytes(
      filenameFromPath(documentPath, title, '.json'),
      new TextEncoder().encode(JSON.stringify(document, null, 2)),
      t('tools.mind-map'),
      ['json'],
    );
    if (!path) return;
    setDocumentPath(path);
    setDirty(false);
    await discardRecoverySnapshot(TOOL_ID, recoveryId.current).catch(() => undefined);
    toast.success(t('mindMap.saved'));
  }, [document, documentPath, t, title]);

  const openSource = useCallback((source: string, path: string) => {
    try {
      const next = path.toLowerCase().endsWith('.md') ? markdownToMindMap(source) : parseMindMapDocument(source);
      loadDocument(next, path);
      toast.success(t('mindMap.opened'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mindMap.openFailed'));
    }
  }, [loadDocument, t]);

  const openXMind = useCallback(async (bytes: ArrayBuffer | Uint8Array, path: string) => {
    try {
      loadDocument(await parseXMindDocument(bytes), path);
      toast.success(t('mindMap.opened'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mindMap.openFailed'));
    }
  }, [loadDocument, t]);

  const open = useCallback(async () => {
    if (dirty && !window.confirm(t('mindMap.unsavedOpen'))) return;
    if (isTauri) {
      const result = await openBinaryDocument(`${t('tools.mind-map')} / XMind、JSON、Markdown`, ['xmind', 'smm', 'json', 'md']);
      if (result) {
        const bytes = Uint8Array.from(atob(result.contents), (character) => character.charCodeAt(0));
        if (result.path.toLowerCase().endsWith('.xmind')) void openXMind(bytes, result.path);
        else openSource(new TextDecoder().decode(bytes), result.path);
      }
      return;
    }
    fileInputRef.current?.click();
  }, [dirty, openSource, openXMind, t]);

  const startNew = useCallback(() => {
    if (dirty && !window.confirm(t('mindMap.unsavedNew'))) return;
    recoveryId.current = createRecoveryId();
    loadDocument(createMindMapDocument(), null);
  }, [dirty, loadDocument, t]);

  const exportImage = useCallback(async (type: 'png' | 'svg') => {
    try {
      const blob = await surfaceRef.current?.exportImage(type, title);
      if (!blob) return;
      await saveBytesWithFeedback(`${title}.${type}`, blob, type.toUpperCase(), [type]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mindMap.exportFailed'));
    }
  }, [t, title]);

  const exportMarkdown = useCallback(async () => {
    try {
      const filename = `${title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 48) || t('mindMap.unnamed')}.md`;
      await saveBytesWithFeedback(filename, new TextEncoder().encode(mindMapToMarkdown(document)), 'Markdown', ['md']);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mindMap.exportFailed'));
    }
  }, [document, t, title]);

  const updateSearch = useCallback((value: string) => {
    setSearchTerm(value);
    if (!value.trim()) {
      surfaceRef.current?.clearSearch();
      setSearchInfo({ currentIndex: -1, total: 0 });
      return;
    }
    surfaceRef.current?.search(value);
  }, []);

  const exitFocus = useCallback(() => setFocusedUid(null), []);

  const focusActiveBranch = useCallback(() => {
    const uid = surfaceRef.current?.activeNodeUid();
    if (!uid || !findNodeByUid(document.root, uid)) {
      toast.message(t('mindMap.focusRequired'));
      return;
    }
    surfaceRef.current?.clearSearch();
    setSearchTerm('');
    setSearchInfo({ currentIndex: -1, total: 0 });
    setFocusedUid(uid);
  }, [document.root, t]);

  const updateLayout = useCallback((layout: string) => {
    setDocument((current) => ({ ...current, layout }));
    setDocumentVersion((value) => value + 1);
    setDirty(true);
  }, []);

  const updateAppearance = useCallback((appearance: string) => {
    const preset = APPEARANCES.find((item) => item.value === appearance) ?? APPEARANCES[0];
    setDocument((current) => ({
      ...current,
      theme: { template: preset.value, config: structuredClone(preset.config) },
    }));
    setDocumentVersion((value) => value + 1);
    setDirty(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && focusedUid) {
        event.preventDefault();
        exitFocus();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Home') {
        event.preventDefault();
        surfaceRef.current?.goRoot();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitFocus, focusedUid, save]);

  const focusedDocument = useMemo(() => {
    if (!focusedUid) return document;
    const node = findNodeByUid(document.root, focusedUid);
    return node ? { ...document, root: structuredClone(node) } : document;
  }, [document, focusedUid]);

  const currentAppearance = APPEARANCES.some((item) => item.value === document.theme?.template)
    ? document.theme?.template ?? 'default'
    : 'default';

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/80 bg-card/40 px-3 py-2">
        <Button variant="ghost" size="sm" onClick={startNew} title={t('mindMap.newTitle')}>
          <FilePlus2 className="mr-1.5 h-4 w-4" />{t('mindMap.new')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void open()} title={t('mindMap.openTitle')}>
          <FolderOpen className="mr-1.5 h-4 w-4" />{t('mindMap.open')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => void save()} title={t('mindMap.saveTitle')}>
          <Save className="mr-1.5 h-4 w-4" />{t('mindMap.save')}{dirty ? ' •' : ''}
        </Button>
        <Button variant={templatesOpen ? 'secondary' : 'ghost'} size="sm" onClick={() => setTemplatesOpen((value) => !value)}>
          <Library className="mr-1.5 h-4 w-4" />{t('mindMap.template')}
        </Button>
        <label className="ml-1 flex items-center gap-1 text-xs text-muted-foreground">
          {t('mindMap.layout')}
          <select
            className="h-8 rounded border border-border bg-background px-1 text-foreground"
            value={document.layout ?? 'logicalStructure'}
            disabled={Boolean(focusedUid)}
            onChange={(event) => updateLayout(event.target.value)}
          >
            {LAYOUTS.map((layout) => <option key={layout.value} value={layout.value}>{t(`mindMap.${layout.key}`)}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          {t('mindMap.appearance')}
          <select
            className="h-8 rounded border border-border bg-background px-1 text-foreground"
            value={currentAppearance}
            disabled={Boolean(focusedUid)}
            onChange={(event) => updateAppearance(event.target.value)}
          >
            {APPEARANCES.map((appearance) => <option key={appearance.value} value={appearance.value}>{t(`mindMap.${appearance.key}`)}</option>)}
          </select>
        </label>
        <span className="mx-1 h-5 w-px bg-border" />
        <Button variant="ghost" size="sm" disabled={Boolean(focusedUid)} onClick={() => surfaceRef.current?.command('INSERT_CHILD_NODE')}>
          <Plus className="mr-1.5 h-4 w-4" />{t('mindMap.child')}
        </Button>
        <Button variant="ghost" size="icon" disabled={Boolean(focusedUid)} onClick={() => surfaceRef.current?.command('BACK')} title={t('mindMap.undo')}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" disabled={Boolean(focusedUid)} onClick={() => surfaceRef.current?.command('FORWARD')} title={t('mindMap.redo')}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => surfaceRef.current?.fit()} title={t('mindMap.fit')}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => surfaceRef.current?.goRoot()} title={t('mindMap.rootTitle')}>
          {t('mindMap.root')}
        </Button>
        <Button variant="ghost" size="sm" disabled={Boolean(focusedUid)} onClick={() => surfaceRef.current?.command('UNEXPAND_ALL')}>
          {t('mindMap.collapseAll')}
        </Button>
        <Button variant="ghost" size="sm" disabled={Boolean(focusedUid)} onClick={() => surfaceRef.current?.command('EXPAND_ALL')}>
          {t('mindMap.expandAll')}
        </Button>
        <Button variant="ghost" size="sm" disabled={Boolean(focusedUid)} onClick={() => surfaceRef.current?.command('UNEXPAND_TO_LEVEL', 3)}>
          {t('mindMap.expandToLevel', { level: 3 })}
        </Button>
        {focusedUid ? (
          <Button variant="secondary" size="sm" onClick={exitFocus}>{t('mindMap.exitFocus')}</Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={focusActiveBranch}>{t('mindMap.focus')}</Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void exportMarkdown()}>
            <Download className="mr-1.5 h-4 w-4" />Markdown
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void exportImage('png')}>
            <Download className="mr-1.5 h-4 w-4" />PNG
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void exportImage('svg')}>
            <Download className="mr-1.5 h-4 w-4" />SVG
          </Button>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 bg-card/20 px-3 py-1.5">
        <input
          ref={searchInputRef}
          value={searchTerm}
          onChange={(event) => updateSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              updateSearch('');
              searchInputRef.current?.blur();
            } else if (event.key === 'Enter' && searchInfo.total > 0) {
              event.preventDefault();
              const offset = event.shiftKey ? -1 : 1;
              surfaceRef.current?.searchNext((searchInfo.currentIndex + offset + searchInfo.total) % searchInfo.total);
            }
          }}
          className="h-8 w-52 rounded border border-border bg-background px-2 text-sm"
          placeholder={t('mindMap.searchPlaceholder')}
          aria-label={t('mindMap.search')}
        />
        <span className="min-w-12 text-xs text-muted-foreground">
          {searchTerm ? t('mindMap.searchCount', { current: searchInfo.total ? searchInfo.currentIndex + 1 : 0, total: searchInfo.total }) : t('mindMap.searchHint')}
        </span>
        <Button variant="ghost" size="sm" disabled={searchInfo.total === 0} onClick={() => surfaceRef.current?.searchNext((searchInfo.currentIndex - 1 + searchInfo.total) % searchInfo.total)}>{t('mindMap.previous')}</Button>
        <Button variant="ghost" size="sm" disabled={searchInfo.total === 0} onClick={() => surfaceRef.current?.searchNext()}>{t('mindMap.next')}</Button>
        {searchTerm && <Button variant="ghost" size="sm" onClick={() => updateSearch('')}>{t('mindMap.clearSearch')}</Button>}
        {focusedUid && <span className="ml-auto text-xs text-muted-foreground">{t('mindMap.focusHint')}</span>}
      </div>
      {templatesOpen && <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/80 bg-card/30 px-3 py-2">
        <span className="text-sm text-muted-foreground">{t('mindMap.templatePrompt')}</span>
        {templates.map((template) => <Button key={template.id} variant="outline" size="sm" onClick={() => {
          if (dirty && !window.confirm(t('mindMap.unsavedNew'))) return;
          recoveryId.current = createRecoveryId();
          loadDocument(structuredClone(template.document), null);
          setDirty(true);
          setTemplatesOpen(false);
        }}>{template.label} · {template.description}</Button>)}
      </div>}
      {recoverySnapshots.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/25 bg-warning/10 px-3 py-2 text-sm">
          <span className="flex-1 text-warning">{t('mindMap.drafts', { count: recoverySnapshots.length })}</span>
          {recoverySnapshots.slice(0, 3).map((snapshot) => (
            <Button
              key={snapshot.id}
              variant="outline"
              size="sm"
              onClick={() => {
                try {
                  loadDocument(parseMindMapDocument(snapshot.content), snapshot.document_path);
                  recoveryId.current = snapshot.id;
                  setDirty(true);
                  setRecoverySnapshots((items) => items.filter((item) => item.id !== snapshot.id));
                } catch {
                  toast.error(t('mindMap.damagedDraft'));
                }
              }}
            >
              {t('mindMap.restore')}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              recoverySnapshots.forEach((snapshot) => void discardRecoverySnapshot(TOOL_ID, snapshot.id));
              setRecoverySnapshots([]);
            }}
          >
            {t('mindMap.discardAll')}
          </Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <MindMapSurface
          key={focusedUid ?? 'full'}
          ref={surfaceRef}
          document={focusedDocument}
          documentVersion={documentVersion}
          readOnly={Boolean(focusedUid)}
          onChange={handleChange}
          onSearchInfoChange={setSearchInfo}
        />
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-border/80 px-3 py-1.5 text-xs text-muted-foreground">
        <span>{title}{dirty ? t('mindMap.unsaved') : ''}</span>
        <span>{focusedUid ? t('mindMap.focusHint') : t('mindMap.hint')}</span>
      </div>
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept=".smm,.json,.md,.xmind,text/markdown,application/json,application/zip"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            if (file.name.toLowerCase().endsWith('.xmind')) void file.arrayBuffer().then((bytes) => openXMind(bytes, file.name));
            else void file.text().then((source) => openSource(source, file.name));
          }
          event.currentTarget.value = '';
        }}
      />
    </section>
  );
}
