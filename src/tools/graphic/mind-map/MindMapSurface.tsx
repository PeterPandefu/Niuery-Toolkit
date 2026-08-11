import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import MindMap, { type MindMapInstance } from 'simple-mind-map';
import ExportPlugin from 'simple-mind-map/src/plugins/Export';
import { createMindMapDocument, type MindMapDocument } from './document';

let exportPluginRegistered = false;

function registerExportPlugin() {
  const register = (MindMap as unknown as Record<string, unknown>)['usePlugin'] as (plugin: unknown) => void;
  register.call(MindMap, ExportPlugin);
}

export interface MindMapSurfaceHandle {
  command: (command: string) => void;
  fit: () => void;
  exportImage: (type: 'png' | 'svg', name: string) => Promise<Blob>;
}

interface MindMapSurfaceProps {
  document: MindMapDocument;
  documentVersion: number;
  onChange: (document: MindMapDocument) => void;
}

export const MindMapSurface = forwardRef<MindMapSurfaceHandle, MindMapSurfaceProps>(function MindMapSurface(
  { document, documentVersion, onChange },
  ref,
) {
  const elementRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<MindMapInstance | null>(null);
  const onChangeRef = useRef(onChange);
  const documentRef = useRef(document);
  const loadingDocumentRef = useRef(false);
  const ignoreNextDataChangeRef = useRef(true);
  onChangeRef.current = onChange;
  documentRef.current = document;

  useEffect(() => {
    if (!elementRef.current) return;
    if (!exportPluginRegistered) {
      registerExportPlugin();
      exportPluginRegistered = true;
    }

    const instance = new MindMap({
      el: elementRef.current,
      data: createMindMapDocument(),
      layout: 'logicalStructure',
      theme: 'classic4',
      enableFreeDrag: true,
    }) as unknown as MindMapInstance;
    const handleDataChange = () => {
      if (loadingDocumentRef.current || ignoreNextDataChangeRef.current) {
        ignoreNextDataChangeRef.current = false;
        return;
      }
      onChangeRef.current(instance.getData(true));
    };
    instance.on('data_change', handleDataChange);
    instanceRef.current = instance;

    return () => {
      instance.off('data_change', handleDataChange);
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
    } finally {
      queueMicrotask(() => { loadingDocumentRef.current = false; });
    }
  }, [documentVersion]);

  useImperativeHandle(ref, () => ({
    command(command) {
      instanceRef.current?.execCommand(command);
    },
    fit() {
      try {
        instanceRef.current?.view.fit();
      } catch {
        // 容器尚未完成布局时，保留当前视图而不干扰编辑。
      }
    },
    async exportImage(type, name) {
      const result = await instanceRef.current?.export(type, false, name);
      if (!result) throw new Error('导出图像失败');
      return fetch(result).then((response) => response.blob());
    },
  }));

  return <div ref={elementRef} className="h-full min-h-0 w-full bg-background" aria-label="思维导图编辑画布" />;
});
