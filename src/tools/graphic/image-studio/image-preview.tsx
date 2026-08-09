import { useEffect, useState } from 'react';

interface ImagePreviewProps {
  files: File[];
}

/** 已选图片的本地缩略图预览，文件变更时自动释放对象 URL。 */
export function ImagePreview({ files }: ImagePreviewProps) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const nextUrls = files.map((file) => URL.createObjectURL(file));
    setUrls(nextUrls);

    return () => nextUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  if (files.length === 0 || urls.length !== files.length) return null;

  const isSingle = files.length === 1;

  return (
    <section className="space-y-2" aria-label="图片预览">
      <span className="text-xs text-muted-foreground">图片预览</span>
      <div className={isSingle ? 'overflow-hidden rounded-lg border border-border bg-muted/30 p-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-3'}>
        {files.map((file, index) => (
          <figure
            key={`${file.name}-${file.lastModified}-${index}`}
            className={isSingle ? undefined : 'min-w-0 overflow-hidden rounded-md border border-border bg-muted/30 p-1.5'}
          >
            <img
              src={urls[index]}
              alt={isSingle ? '已选图片预览' : `${file.name} 图片预览`}
              className={isSingle ? 'max-h-80 w-full rounded-md object-contain' : 'h-24 w-full rounded object-contain'}
            />
            {!isSingle && <figcaption className="mt-1 truncate text-[11px] text-muted-foreground">{file.name}</figcaption>}
          </figure>
        ))}
      </div>
    </section>
  );
}
