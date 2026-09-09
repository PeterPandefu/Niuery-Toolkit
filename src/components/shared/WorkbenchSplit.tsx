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

/** 复合工具：预览主区 + 右侧属性。无法拆分时回退为单列。 */
export function WorkbenchSplit({ children, preview, properties, className }: WorkbenchSplitProps) {
  const explicitPreview = preview == null ? [] : Children.toArray(preview);
  const explicitProperties = properties == null ? [] : Children.toArray(properties);

  if (explicitPreview.length > 0 && explicitProperties.length > 0) {
    return <SplitLayout preview={explicitPreview} properties={explicitProperties} className={className} />;
  }

  const nodes = Children.toArray(children);
  const autoPreview = nodes.filter(isPreviewNode);
  const autoProperties = nodes.filter((node) => !isPreviewNode(node));

  if (autoPreview.length === 0 || autoProperties.length === 0) {
    return <div className={cn('space-y-4', className)}>{children}</div>;
  }

  return <SplitLayout preview={autoPreview} properties={autoProperties} className={className} />;
}
