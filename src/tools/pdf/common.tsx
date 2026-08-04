import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { File as FileIcon, Plus, ShieldCheck, X } from 'lucide-react';
import { formatBytes } from '@/lib/utils';

interface FileDropzoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  hint?: string;
}

/** 虚线拖放区：点击选择 + 拖入文件，附已选文件列表 */
export function FileDropzone({ files, onChange, multiple = false, accept = '.pdf', hint }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    onChange(multiple ? [...files, ...incoming] : incoming.slice(0, 1));
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        <p className="text-sm text-muted-foreground">拖入文件到这里</p>
        <Button
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <Plus />
          选择文件
        </Button>
        {hint && <p className="text-xs text-muted-foreground/70">{hint}</p>}
      </div>

      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs"
            >
              <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{file.name}</span>
              <span className="shrink-0 font-mono text-muted-foreground">{formatBytes(file.size)}</span>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                title="移除"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 本地处理隐私提示 */
export function PrivacyNote() {
  return (
    <div className="flex items-center justify-center gap-1.5 pt-2 text-xs text-muted-foreground">
      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
      全程本地处理，文件不离开设备
    </div>
  );
}

/** 选项行：左标签右控件 */
export function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[90px_1fr] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div>{children}</div>
    </div>
  );
}
