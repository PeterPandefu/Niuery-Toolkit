import { useState } from 'react';
import { FileLock2, FolderOpen, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProcessToolPage, type ToolKind } from './process-tool-page';

const MODES = [
  { kind: 'port', label: '端口', icon: Network },
  { kind: 'file', label: '文件', icon: FileLock2 },
  { kind: 'folder', label: '文件夹', icon: FolderOpen },
] as const;

export default function ResourceUnlocker() {
  const [kind, setKind] = useState<ToolKind>('port');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap gap-2 border-b border-border px-6 py-3 sm:px-8" role="group" aria-label="占用目标类型">
        {MODES.map((mode) => (
          <Button key={mode.kind} variant={kind === mode.kind ? 'default' : 'outline'} aria-pressed={kind === mode.kind} onClick={() => setKind(mode.kind)}>
            <mode.icon aria-hidden="true" />{mode.label}
          </Button>
        ))}
      </div>
      <div className="min-h-0 flex-1"><ProcessToolPage key={kind} kind={kind} /></div>
    </div>
  );
}
