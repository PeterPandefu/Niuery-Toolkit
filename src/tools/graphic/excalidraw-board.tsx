import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  Excalidraw,
  MainMenu,
  exportToBlob,
  exportToSvg,
  loadFromBlob,
  serializeAsJSON,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, FilePlus2, FolderOpen, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import { saveBytes, saveBytesWithFeedback } from '@/lib/file-save';
import {
  discardRecoverySnapshot,
  listRecoverySnapshots,
  openTextDocument,
  type RecoverySnapshot,
  writeRecoverySnapshot,
} from '@/lib/local-documents';
import { isTauri } from '@/lib/api-client';
import { showOperationError } from '@/lib/operation-feedback';

const TOOL_ID = 'excalidraw-board';

type ExcalidrawProps = ComponentProps<typeof Excalidraw>;
type SceneChange = Parameters<NonNullable<ExcalidrawProps['onChange']>>;
type ExcalidrawApi = Parameters<NonNullable<ExcalidrawProps['excalidrawAPI']>>[0];

function ExcalidrawMainMenu() {
  const { DefaultItems } = MainMenu;

  return (
    <MainMenu>
      <DefaultItems.LoadScene />
      <DefaultItems.SaveToActiveFile />
      <DefaultItems.Export />
      <DefaultItems.SaveAsImage />
      <DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <DefaultItems.ToggleTheme />
      <DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
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

export default function ExcalidrawBoard() {
  const { t, i18n } = useTranslation();
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const sceneRef = useRef<SceneChange | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recoveryId = useRef(createRecoveryId());
  const recoveryTimerRef = useRef<number | null>(null);
  const documentPathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const ignoreNextSceneChangeRef = useRef(true);
  const [documentPath, setDocumentPath] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [recoverySnapshots, setRecoverySnapshots] = useState<RecoverySnapshot[]>([]);

  const serializeScene = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return null;
    const [elements, appState, files] = scene;
    return serializeAsJSON(elements, appState, files, 'local');
  }, []);

  const loadScene = useCallback(async (source: string, path: string | null, restored = false) => {
    const loaded = await loadFromBlob(new Blob([source], { type: 'application/json' }), null, null);
    apiRef.current?.addFiles(Object.values(loaded.files));
    ignoreNextSceneChangeRef.current = true;
    apiRef.current?.updateScene({
      elements: loaded.elements,
      appState: loaded.appState,
    });
    sceneRef.current = [loaded.elements, loaded.appState, loaded.files] as unknown as SceneChange;
    documentPathRef.current = path;
    setDocumentPath(path);
    dirtyRef.current = restored;
    setDirty(restored);
  }, []);

  useEffect(() => {
    void listRecoverySnapshots(TOOL_ID).then(setRecoverySnapshots).catch(() => undefined);
  }, []);

  const queueRecovery = useCallback(() => {
    if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = window.setTimeout(() => {
      const content = serializeScene();
      if (content) {
        void writeRecoverySnapshot(TOOL_ID, recoveryId.current, content, documentPathRef.current).catch(() => undefined);
      }
    }, 2000);
  }, [serializeScene]);

  useEffect(() => () => {
    if (recoveryTimerRef.current !== null) window.clearTimeout(recoveryTimerRef.current);
  }, []);

  const onChange = useCallback((...scene: SceneChange) => {
    sceneRef.current = scene;
    if (ignoreNextSceneChangeRef.current) {
      ignoreNextSceneChangeRef.current = false;
      return;
    }
    // Excalidraw 会在初始化与切换工具时发出空场景变更，不应把新白板标记为已编辑。
    if (scene[0].length === 0) return;
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setDirty(true);
    }
    queueRecovery();
  }, [queueRecovery]);

  const startNew = useCallback(() => {
    if (dirty && !window.confirm(t('whiteboard.unsavedNew'))) return;
    recoveryId.current = createRecoveryId();
    ignoreNextSceneChangeRef.current = true;
    apiRef.current?.updateScene({ elements: [], appState: {} });
    sceneRef.current = [[], {}, {}] as unknown as SceneChange;
    documentPathRef.current = null;
    setDocumentPath(null);
    dirtyRef.current = false;
    setDirty(false);
  }, [dirty, t]);

  const save = useCallback(async () => {
    const content = serializeScene();
    if (!content) return;
    try {
      const path = await saveBytes(
        filenameFromPath(documentPath, t('whiteboard.unnamed'), '.excalidraw'),
        new TextEncoder().encode(content),
        t('whiteboard.excalidrawFile'),
        ['excalidraw'],
      );
      if (!path) return;
      documentPathRef.current = path;
      setDocumentPath(path);
      dirtyRef.current = false;
      setDirty(false);
      await discardRecoverySnapshot(TOOL_ID, recoveryId.current).catch(() => undefined);
      toast.success(t('whiteboard.saved'));
    } catch (error) {
      showOperationError({ message: t('whiteboard.saveFailed', '白板保存失败'), error, retry: () => void save(), retryLabel: t('actions.retry', '重试'), copyLabel: t('actions.copyDetails', '复制详情'), logsLabel: t('app.logs', '查看日志') });
    }
  }, [documentPath, serializeScene, t]);

  const openSource = useCallback(async (source: string, path: string) => {
    try {
      await loadScene(source, path);
      toast.success(t('whiteboard.opened'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('whiteboard.openFailed'));
    }
  }, [loadScene, t]);

  const open = useCallback(async () => {
    if (dirty && !window.confirm(t('whiteboard.unsavedOpen'))) return;
    if (isTauri) {
      const result = await openTextDocument(t('whiteboard.excalidrawFile'), ['excalidraw', 'json']);
      if (result) await openSource(result.contents, result.path);
      return;
    }
    fileInputRef.current?.click();
  }, [dirty, openSource, t]);

  const exportScene = useCallback(async (format: 'png' | 'svg') => {
    const scene = sceneRef.current;
    if (!scene) return;
    const [elements, appState, files] = scene;
    try {
      const blob = format === 'png'
        ? await exportToBlob({ elements, appState, files, mimeType: 'image/png', exportBackground: true })
        : new Blob([(await exportToSvg({ elements, appState, files, exportBackground: true })).outerHTML], { type: 'image/svg+xml' });
      await saveBytesWithFeedback(`${t('whiteboard.unnamed')}.${format}`, blob, format.toUpperCase(), [format]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('whiteboard.exportFailed'));
    }
  }, [t]);

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/80 bg-card/40 px-3 py-2">
        <Button variant="ghost" size="sm" onClick={startNew} title={t('whiteboard.newTitle')}><FilePlus2 className="mr-1.5 h-4 w-4" />{t('whiteboard.new')}</Button>
        <LoadingButton variant="ghost" size="sm" onClick={open} title={t('whiteboard.openTitle')}><FolderOpen className="mr-1.5 h-4 w-4" />{t('whiteboard.open')}</LoadingButton>
        <LoadingButton variant="ghost" size="sm" onClick={save} title={t('whiteboard.saveTitle')}><Save className="mr-1.5 h-4 w-4" />{t('whiteboard.save')}{dirty ? ' •' : ''}</LoadingButton>
        <div className="ml-auto flex items-center gap-1">
          <LoadingButton variant="ghost" size="sm" onClick={() => exportScene('png')}><Download className="mr-1.5 h-4 w-4" />PNG</LoadingButton>
          <LoadingButton variant="ghost" size="sm" onClick={() => exportScene('svg')}><Download className="mr-1.5 h-4 w-4" />SVG</LoadingButton>
        </div>
      </div>
      {recoverySnapshots.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b border-warning/25 bg-warning/10 px-3 py-2 text-sm">
          <span className="flex-1 text-warning">{t('whiteboard.drafts', { count: recoverySnapshots.length })}</span>
          {recoverySnapshots.slice(0, 3).map((snapshot) => (
            <Button key={snapshot.id} variant="outline" size="sm" onClick={() => {
              void loadScene(snapshot.content, snapshot.document_path, true)
                .then(() => setRecoverySnapshots((items) => items.filter((item) => item.id !== snapshot.id)))
                .catch(() => toast.error(t('whiteboard.damagedDraft')));
            }}>{t('whiteboard.restore')}</Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => {
            recoverySnapshots.forEach((snapshot) => void discardRecoverySnapshot(TOOL_ID, snapshot.id));
            setRecoverySnapshots([]);
          }}>{t('whiteboard.discardAll')}</Button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <Excalidraw
          // 使用宿主菜单，移除不适用于本地工具的搜索、帮助和社区链接。
          children={<ExcalidrawMainMenu />}
          excalidrawAPI={(api) => { apiRef.current = api; }}
          onChange={onChange}
          langCode={i18n.resolvedLanguage?.startsWith('zh') ? 'zh-CN' : 'en'}
          name={t('whiteboard.excalidrawTitle')}
        />
      </div>
      <input ref={fileInputRef} className="hidden" type="file" accept=".excalidraw,.json,application/json" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) void file.text().then((source) => openSource(source, file.name));
        event.currentTarget.value = '';
      }} />
    </section>
  );
}
