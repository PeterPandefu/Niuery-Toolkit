import { Children, isValidElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

function componentName(node: ReactNode) {
  if (!isValidElement(node)) return '';
  const type = node.type as { displayName?: string; name?: string };
  return type.displayName ?? type.name ?? '';
}

function isPreviewNode(node: ReactNode) {
  if (!isValidElement(node)) return false;
  if ((node.props as { 'data-workbench'?: string })['data-workbench'] === 'preview') return true;
  const name = componentName(node);
  return name === 'FileDropzone' || name === 'ImageFileDropzone' || name === 'ImagePreview' || name === 'ProcessingResultPreview';
}

interface WorkbenchSplitProps {
  children?: ReactNode;
  preview?: ReactNode;
  properties?: ReactNode;
  emptyFooter?: ReactNode;
  /** 未选择文件时收成单列舞台，不展开右侧属性栏 */
  empty?: boolean;
  className?: string;
}

function SplitLayout({ preview, properties, className }: { preview: ReactNode[]; properties: ReactNode[]; className?: string }) {
  return (
    <div className={cn('grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18.5rem]', className)}>
      <section className="min-w-0 space-y-3">{preview}</section>
      <aside className="space-y-4 rounded-lg border border-border bg-card p-4 shadow-tinted-sm">{properties}</aside>
    </div>
  );
}

function StageLayout({ preview, footer, className }: { preview: ReactNode[]; footer?: ReactNode; className?: string }) {
  return (
    <div className={cn('mx-auto w-full max-w-2xl space-y-3 [&_[data-dropzone]]:min-h-[280px]', className)}>
      {preview}
      {footer ? <div className="flex flex-wrap items-center justify-center gap-2 px-1">{footer}</div> : null}
    </div>
  );
}

function resolvePanes({ children, preview, properties }: Pick<WorkbenchSplitProps, 'children' | 'preview' | 'properties'>) {
  const explicitPreview = preview == null ? [] : Children.toArray(preview);
  const explicitProperties = properties == null ? [] : Children.toArray(properties);

  if (explicitPreview.length > 0 && explicitProperties.length > 0) {
    return { preview: explicitPreview, properties: explicitProperties };
  }

  const nodes = Children.toArray(children);
  const autoPreview = nodes.filter(isPreviewNode);
  const autoProperties = nodes.filter((node) => !isPreviewNode(node));

  if (autoPreview.length === 0 || autoProperties.length === 0) {
    return { preview: [], properties: [], fallback: nodes };
  }

  return { preview: autoPreview, properties: autoProperties };
}

/** 复合工具：预览主区 + 右侧属性。空态收成舞台；无法拆分时回退为单列。 */
export function WorkbenchSplit({ children, preview, properties, emptyFooter, empty = false, className }: WorkbenchSplitProps) {
  const panes = resolvePanes({ children, preview, properties });

  if (panes.fallback) {
    return <div className={cn('space-y-4', className)}>{children}</div>;
  }

  if (empty) {
    return <StageLayout preview={panes.preview} footer={emptyFooter} className={className} />;
  }

  return <SplitLayout preview={panes.preview} properties={panes.properties} className={className} />;
}
