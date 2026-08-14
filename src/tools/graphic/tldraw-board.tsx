import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTLStore,
  defaultShapeUtils,
  parseTldrawJsonFile,
  serializeTldrawJson,
  Tldraw,
  type Editor,
  type TLStore,
} from '@tldraw/tldraw';
import { getAssetUrls } from '@tldraw/assets/selfHosted';
import '@tldraw/tldraw/tldraw.css';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, FilePlus2, FolderOpen, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { saveBytes } from '@/lib/file-save';
import {
  discardRecoverySnapshot,
  listRecoverySnapshots,
  openTextDocument,
  type RecoverySnapshot,
  writeRecoverySnapshot,
} from '@/lib/local-documents';
import { isTauri } from '@/lib/api-client';

const TOOL_ID = 'tldraw-board';
// 资源由 Vite 在开发与生产环境统一提供，避免 Tauri 包内落到 node_modules 或 CDN 地址。
const localAssets = getAssetUrls({ baseUrl: './tldraw-assets' });

function createStore(): TLStore {
  return createTLStore({ shapeUtils: defaultShapeUtils });
}

function createRecoveryId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

function filenameFromPath(path: string | null, fallback: string, extension: string) {
  if (!path) return `${fallback.replace(/[\\/:*?"<>|]/g, '-').slice(0, 48) || '未命名白板'}${extension}`;
  return path.split(/[\\/]/).pop() ?? `${fallback}${extension}`;
}

export default function TldrawBoard() {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const recoveryId = useRef(createRecoveryId());
  const [store, setStore] = useState<TLStore>(() => createStore());
  const [storeKey, setStoreKey] = useState(0);
  const recoveryTimerRef = useRef<number | null>(null);
  const documentPathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([]);

  const pageShapeIds = useCallback(() => Array.from(editorRef.current?.getCurrentPageShapeIds() ?? []), []);

  useEffect(() => {
    void listRecoverySnapshots(TOOL_ID).then(setRecoverySnapshots).catch(() => undefined);
  }, []);

  const queueRecovery = useCallback(() => {
    if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;
      void serializeTldrawJson(editor)
        .then((content) => writeRecoverySnapshot(TOOL_ID, recoveryId.current, content, documentPathRef.current))
        .catch(() => undefined);
    }, 2000);
  }, []);

  useEffect(() => () => {
    if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
  }, []);

  const replaceStore = useCallback((next: TLStore, path: string | null, restored = false) => {
    editorRef.current = null;
    setStore(next);
    setStoreKey((value) => value + 1);
    documentPathRef.current = path;
    setDocumentPath(path);
    dirtyRef.current = restored;
    setDirty(restored);
  }, []);

  const startNew = useCallback(() => {
    if (dirty && !window.confirm(t('whiteboard.unsavedNew'))) return;
    recoveryId.current = createRecoveryId();
    replaceStore(createStore(), null);
  }, [dirty, replaceStore, t]);

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const path = await saveBytes(
      filenameFromPath(documentPath, t('whiteboard.unnamed'), '.tldr'),
      new TextEncoder().encode(await serializeTldrawJson(editor)),
      t('whiteboard.tldrawFile'),
      ['tldr'],
    );
    if (!path) return;
    documentPathRef.current = path;
    setDocumentPath(path);
    dirtyRef.current = false;
    setDirty(false);
    await discardRecoverySnapshot(TOOL_ID, recoveryId.current).catch(() => undefined);
    toast.success(t('whiteboard.saved'));
  }, [documentPath, t]);

  const openSource = useCallback((source: string, path: string | null, restored = false) => {
    const next = createStore();
    const result = parseTldrawJsonFile({ json: source, schema: next.schema });
    if (!result.ok) throw new Error(t('whiteboard.openFailed'));
    replaceStore(result.value, path, restored);
  }, [replaceStore, t]);

  const open = useCallback(async () => {
    if (dirty && !window.confirm(t('whiteboard.unsavedOpen'))) return;
    if (isTauri) {
      const result = await openTextDocument(t('whiteboard.tldrawFile'), ['tldr']);
      if (result) {
        try {
          openSource(result.contents, result.path);
          toast.success(t('whiteboard.opened'));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('whiteboard.openFailed'));
        }
      }
      return;
    }
    fileInputRef.current?.click();
  }, [dirty, openSource, t]);

  const exportSvg = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const result = await editor.getSvgString(pageShapeIds(), { background: true });
    if (!result) {
      toast.error(t('whiteboard.emptyExport'));
      return;
    }
    await saveBytes(
      `${t('whiteboard.unnamed')}.svg`,
      new Blob([result.svg], { type: 'image/svg+xml' }),
      'SVG',
      ['svg'],
    );
  }, [pageShapeIds, t]);

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    return editor.store.listen(() => {
      if (!dirtyRef.current) {
        dirtyRef.current = true;
        setDirty(true);
      }
      queueRecovery();
    }, { source: 'user', scope: 'document' });
  }, [queueRecovery]);

  const tldrawProps = useMemo(() => ({ assetUrls: localAssets }), []);

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/80 bg-card/40 px-3 py-2">
        <Button variant="ghost" size="sm" onClick={startNew} title={t('whiteboard.newTitle')}><FilePlus2 className="mr-1.5 h-4 w-4" />{t('whiteboard.new')}</Button>
        <Button variant="ghost" size="sm" onClick={() => void open()} title={t('whiteboard.openTitle')}><FolderOpen className="mr-1.5 h-4 w-4" />{t('whiteboard.open')}</Button>
        <Button variant="ghost" size="sm" onClick={() => void save()} title={t('whiteboard.saveTitle')}><Save className="mr-1.5 h-4 w-4" />{t('whiteboard.save')}{dirty ? ' •' : ''}</Button>
        <div className="ml-auto flex items-center gap-1"><Button variant="ghost" size="sm" onClick={() => void exportSvg()}><Download className="mr-1.5 h-4 w-4" />SVG</Button></div>
      </div>
      {recoverySnapshots.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/25 bg-warning/10 px-3 py-2 text-sm">
          <span className="flex-1 text-warning">{t('whiteboard.drafts', { count: recoverySnapshots.length })}</span>
          {recoverySnapshots.slice(0, 3).map((snapshot) => (
            <Button key={snapshot.id} variant="outline" size="sm" onClick={() => {
              try {
                openSource(snapshot.content, snapshot.document_path, true);
                setRecoverySnapshots((items) => items.filter((item) => item.id !== snapshot.id));
              } catch {
                toast.error(t('whiteboard.damagedDraft'));
              }
            }}>{t('whiteboard.restore')}</Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => {
            recoverySnapshots.forEach((snapshot) => void discardRecoverySnapshot(TOOL_ID, snapshot.id));
            setRecoverySnapshots([]);
          }}>{t('whiteboard.discardAll')}</Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Tldraw key={storeKey} store={store} onMount={handleMount} {...tldrawProps} />
      </div>
      <input ref={fileInputRef} className="hidden" type="file" accept=".tldr,application/json" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) {
          void file.text().then((source) => {
            try {
              openSource(source, file.name);
              toast.success(t('whiteboard.opened'));
            } catch (error) {
              toast.error(error instanceof Error ? error.message : t('whiteboard.openFailed'));
            }
          });
        }
        event.currentTarget.value = '';
      }} />
    </section>
  );
}
