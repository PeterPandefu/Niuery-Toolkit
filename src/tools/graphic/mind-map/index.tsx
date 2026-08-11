import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FilePlus2, FolderOpen, Library, Plus, Redo2, Save, Undo2, ZoomIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { saveBytes } from '@/lib/file-save';
import {
  discardRecoverySnapshot,
  listRecoverySnapshots,
  openTextDocument,
  writeRecoverySnapshot,
  type RecoverySnapshot,
} from '@/lib/local-documents';
import { isTauri } from '@/lib/api-client';
import { MindMapSurface, type MindMapSurfaceHandle } from './MindMapSurface';
import {
  createMindMapDocument,
  markdownToMindMap,
  parseMindMapDocument,
  type MindMapDocument,
} from './document';

const TOOL_ID = 'mind-map';

function createRecoveryId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function filenameFromPath(path: string | null, fallback: string, extension: string) {
  if (!path) return `${fallback.replace(/[\\/:*?"<>|]/g, '-').slice(0, 48) || '未命名'}${extension}`;
  return path.split(/[\\/]/).pop() ?? `${fallback}${extension}`;
}

export default function MindMapTool() {
  const { t } = useTranslation();
  const surfaceRef = useRef<MindMapSurfaceHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recoveryId = useRef(createRecoveryId());
  const [document, setDocument] = useState<MindMapDocument>(() => createMindMapDocument(t('mindMap.unnamed')));
  const [documentVersion, setDocumentVersion] = useState(0);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([]);
  const [templatesOpen, setTemplatesOpen] = useState(false);

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
        layout: 'logicalStructure', theme: { template: 'classic4', config: {} },
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
        layout: 'logicalStructure', theme: { template: 'classic4', config: {} },
      } satisfies MindMapDocument,
    },
  ], [t]);

  const loadDocument = useCallback((next: MindMapDocument, path: string | null = null) => {
    setDocument(next);
    setDocumentPath(path);
    setDocumentVersion((value) => value + 1);
    setDirty(false);
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
      filenameFromPath(documentPath, title, '.smm'),
      new TextEncoder().encode(JSON.stringify(document, null, 2)),
      t('tools.mind-map'),
      ['smm'],
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

  const open = useCallback(async () => {
    if (dirty && !window.confirm(t('mindMap.unsavedOpen'))) return;
    if (isTauri) {
      const result = await openTextDocument(`${t('tools.mind-map')} / Markdown`, ['smm', 'json', 'md']);
      if (result) openSource(result.contents, result.path);
      return;
    }
    fileInputRef.current?.click();
  }, [dirty, openSource, t]);

  const startNew = useCallback(() => {
    if (dirty && !window.confirm(t('mindMap.unsavedNew'))) return;
    recoveryId.current = createRecoveryId();
    loadDocument(createMindMapDocument(), null);
  }, [dirty, loadDocument, t]);

  const exportImage = useCallback(async (type: 'png' | 'svg') => {
    try {
      const blob = await surfaceRef.current?.exportImage(type, title);
      if (!blob) return;
      await saveBytes(`${title}.${type}`, blob, type.toUpperCase(), [type]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('mindMap.exportFailed'));
    }
  }, [t, title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      void save();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

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
        <span className="mx-1 h-5 w-px bg-border" />
        <Button variant="ghost" size="sm" onClick={() => surfaceRef.current?.command('INSERT_CHILD_NODE')}>
          <Plus className="mr-1.5 h-4 w-4" />{t('mindMap.child')}
        </Button>
        <Button variant="ghost" size="icon" onClick={() => surfaceRef.current?.command('BACK')} title={t('mindMap.undo')}>
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => surfaceRef.current?.command('FORWARD')} title={t('mindMap.redo')}>
          <Redo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => surfaceRef.current?.fit()} title={t('mindMap.fit')}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void exportImage('png')}>
            <Download className="mr-1.5 h-4 w-4" />PNG
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void exportImage('svg')}>
            <Download className="mr-1.5 h-4 w-4" />SVG
          </Button>
        </div>
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
        <MindMapSurface ref={surfaceRef} document={document} documentVersion={documentVersion} onChange={handleChange} />
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-border/80 px-3 py-1.5 text-xs text-muted-foreground">
        <span>{title}{dirty ? t('mindMap.unsaved') : ''}</span>
        <span>{t('mindMap.hint')}</span>
      </div>
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept=".smm,.json,.md,text/markdown,application/json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void file.text().then((source) => openSource(source, file.name));
          event.currentTarget.value = '';
        }}
      />
    </section>
  );
}
