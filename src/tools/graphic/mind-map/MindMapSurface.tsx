import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import MindMap, { type MindMapInstance } from 'simple-mind-map';
import ExportPlugin from 'simple-mind-map/src/plugins/Export';
import SearchPlugin from 'simple-mind-map/src/plugins/Search';
import KeyboardNavigationPlugin from 'simple-mind-map/src/plugins/KeyboardNavigation';
import { createMindMapDocument, type MindMapDocument } from './document';

let pluginsRegistered = false;

function registerPlugins() {
  const register = (MindMap as unknown as Record<string, unknown>)['usePlugin'] as (plugin: unknown) => void;
  register.call(MindMap, ExportPlugin);
  register.call(MindMap, SearchPlugin);
  register.call(MindMap, KeyboardNavigationPlugin);
}

export interface MindMapSurfaceHandle {
  command: (command: string, ...args: unknown[]) => void;
  fit: () => void;
  goRoot: () => void;
  search: (text: string) => void;
  searchNext: (index?: number) => void;
  clearSearch: () => void;
  activeNodeUid: () => string | null;
  exportImage: (type: 'png' | 'svg', name: string) => Promise<Blob>;
}

interface MindMapSurfaceProps {
  document: MindMapDocument;
  documentVersion: number;
  readOnly?: boolean;
  onChange: (document: MindMapDocument) => void;
  onSearchInfoChange?: (info: { currentIndex: number; total: number }) => void;
}

export const MindMapSurface = forwardRef<MindMapSurfaceHandle, MindMapSurfaceProps>(function MindMapSurface(
  { document, documentVersion, readOnly = false, onChange, onSearchInfoChange },
  ref,
) {
  const elementRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<MindMapInstance | null>(null);
  const onChangeRef = useRef(onChange);
  const onSearchInfoChangeRef = useRef(onSearchInfoChange);
  const documentRef = useRef(document);
  const loadingDocumentRef = useRef(false);
  const ignoreNextDataChangeRef = useRef(true);
  onChangeRef.current = onChange;
  onSearchInfoChangeRef.current = onSearchInfoChange;
  documentRef.current = document;

  useEffect(() => {
    if (!elementRef.current) return;
    if (!pluginsRegistered) {
      registerPlugins();
      pluginsRegistered = true;
    }

    const instance = new MindMap({
      el: elementRef.current,
      data: createMindMapDocument(),
      layout: 'logicalStructure',
      theme: 'default',
      enableFreeDrag: true,
      // 画布不约束导图位置，可在四个方向持续平移。
      isLimitMindMapInCanvas: false,
      isDisableDrag: false,
      maxZoomRatio: -1,
      readonly: readOnly,
    }) as unknown as MindMapInstance;
    const handleDataChange = () => {
      if (loadingDocumentRef.current || ignoreNextDataChangeRef.current) {
        ignoreNextDataChangeRef.current = false;
        return;
      }
      onChangeRef.current(instance.getData(true));
    };
    instance.on('data_change', handleDataChange);
    const handleSearchInfoChange = (info: unknown) => {
      const value = info as { currentIndex?: unknown; total?: unknown };
      onSearchInfoChangeRef.current?.({
        currentIndex: typeof value.currentIndex === 'number' ? value.currentIndex : -1,
        total: typeof value.total === 'number' ? value.total : 0,
      });
    };
    instance.on('search_info_change', handleSearchInfoChange);
    instanceRef.current = instance;

    return () => {
      instance.off('data_change', handleDataChange);
      instance.off('search_info_change', handleSearchInfoChange);
      instance.destroy();
      instanceRef.current = null;
    };
    // 仅在挂载时创建实例；新文档通过 documentVersion 显式载入。
  }, []);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) return;
    ignoreNextDataChangeRef.current = true;
    loadingDocumentRef.current = true;
    try {
      instance.setFullData(documentRef.current);
      requestAnimationFrame(() => {
        const root = (instance as MindMapInstance & {
          renderer?: { root?: unknown };
        }).renderer?.root;
        if (root) instance.execCommand('GO_TARGET_NODE', root);
      });
    } finally {
      queueMicrotask(() => { loadingDocumentRef.current = false; });
    }
  }, [documentVersion]);

  useImperativeHandle(ref, () => ({
    command(command, ...args) {
      instanceRef.current?.execCommand(command, ...args);
    },
    search(text) {
      const search = instanceRef.current?.search;
      if (!search) return;
      if (!text.trim()) {
        search.endSearch();
        return;
      }
      search.search(text);
    },
    searchNext(index) {
      const search = instanceRef.current?.search;
      if (!search) return;
      if (index === undefined) search.searchNext();
      else search.jump(index);
    },
    clearSearch() {
      instanceRef.current?.search?.endSearch();
    },
    activeNodeUid() {
      const instance = instanceRef.current as (MindMapInstance & {
        renderer?: { activeNodeList?: Array<{ getData: (key: string) => unknown }> };
      }) | null;
      const uid = instance?.renderer?.activeNodeList?.[0]?.getData('uid');
      return typeof uid === 'string' ? uid : null;
    },
    fit() {
      try {
        instanceRef.current?.view.fit();
      } catch {
        // 容器尚未完成布局时，保留当前视图而不干扰编辑。
      }
    },
    goRoot() {
      const instance = instanceRef.current as (MindMapInstance & {
        renderer?: { root?: unknown };
      }) | null;
      const root = instance?.renderer?.root;
      if (root) instance.execCommand('GO_TARGET_NODE', root);
    },
    async exportImage(type, name) {
      const result = await instanceRef.current?.export(type, false, name);
      if (!result) throw new Error('导出图像失败');
      return fetch(result).then((response) => response.blob());
    },
  }));

  return <div ref={elementRef} className="h-full min-h-0 w-full bg-background" aria-label={readOnly ? '思维导图聚焦视图' : '思维导图编辑画布'} />;
});
