import { useState, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  FolderPlus,
  Trash2,
  Clock,
  Folder,
  FileText,
  ChevronRight,
  ChevronDown,
  Save,
  Upload,
  Download,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { saveBytesWithFeedback } from '@/lib/file-save';
import {
  useApiTesterStore,
  type ApiRequest,
  type Collection,
  type HttpMethod,
} from '@/store/api-tester-store';

interface CollectionSidebarProps {
  onLoadRequest: (req: ApiRequest) => void;
}

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-green-600 dark:text-green-400',
  POST: 'text-yellow-600 dark:text-yellow-400',
  PUT: 'text-blue-600 dark:text-blue-400',
  PATCH: 'text-purple-600 dark:text-purple-400',
  DELETE: 'text-red-600 dark:text-red-400',
  HEAD: 'text-cyan-600 dark:text-cyan-400',
  OPTIONS: 'text-gray-600 dark:text-gray-400',
};

export function CollectionSidebar({ onLoadRequest }: CollectionSidebarProps) {
  const [tab, setTab] = useState<'collections' | 'history'>('collections');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    collections,
    addCollection,
    removeCollection,
    renameCollection,
    addToCollection,
    removeFromCollection,
    history,
    removeHistory,
    clearHistory,
    currentRequest,
    importCollections,
  } = useApiTesterStore();

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSaveToCollection = (collectionId: string) => {
    addToCollection(collectionId, { ...currentRequest, id: crypto.randomUUID().slice(0, 10) });
    toast.success('已保存到集合');
  };

  const handleExport = async () => {
    const data = JSON.stringify(collections, null, 2);
    await saveBytesWithFeedback('api-collections.json', new Blob([data], { type: 'application/json' }), 'JSON 文件', ['json']);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result as string) as Collection[];
        if (Array.isArray(data)) {
          importCollections(data);
          toast.success(`已导入 ${data.length} 个集合`);
        }
      } catch {
        toast.error('导入失败：无效的 JSON 文件');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const confirmRename = () => {
    if (editingId && editName.trim()) {
      renameCollection(editingId, editName.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="flex h-full flex-col border-r">
      {/* Tabs */}
      <div className="flex items-center border-b">
        <button
          onClick={() => setTab('collections')}
          className={cn(
            'flex-1 px-3 py-2 text-xs font-medium transition-colors',
            tab === 'collections' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground'
          )}
        >
          集合
        </button>
        <button
          onClick={() => setTab('history')}
          className={cn(
            'flex-1 px-3 py-2 text-xs font-medium transition-colors',
            tab === 'history' ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground'
          )}
        >
          历史
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        {tab === 'collections' ? (
          <>
            <Button variant="ghost" size="icon" className="h-6 w-6" title="新建集合" onClick={() => addCollection()}>
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" title="导入" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" title="导出" onClick={handleExport}>
              <Download className="h-3.5 w-3.5" />
            </Button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
          </>
        ) : (
          <Button variant="ghost" size="sm" className="h-6 gap-1 text-xs" onClick={clearHistory}>
            <Trash2 className="h-3 w-3" />
            清空
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'collections' ? (
          <div className="space-y-1">
            {collections.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">
                暂无集合，点击 + 创建
              </p>
            )}
            {collections.map((col) => (
              <div key={col.id}>
                <div className="group flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted">
                  <button onClick={() => toggleFolder(col.id)} className="shrink-0">
                    {expandedFolders.has(col.id) ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </button>
                  <Folder className="h-3.5 w-3.5 shrink-0 text-yellow-500" />
                  {editingId === col.id ? (
                    <input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={confirmRename}
                      onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                      className="h-5 flex-1 rounded border bg-background px-1 text-xs outline-none"
                      autoFocus
                    />
                  ) : (
                    <span className="flex-1 truncate text-xs font-medium">{col.name}</span>
                  )}
                  <div className="hidden gap-0.5 group-hover:flex">
                    <button className="p-0.5" title="保存当前请求" onClick={() => handleSaveToCollection(col.id)}>
                      <Save className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                    <button className="p-0.5" title="重命名" onClick={() => startRename(col.id, col.name)}>
                      <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                    <button className="p-0.5" title="删除" onClick={() => removeCollection(col.id)}>
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>

                {expandedFolders.has(col.id) && (
                  <div className="ml-5 space-y-0.5">
                    {col.items.length === 0 && (
                      <p className="py-1 text-[10px] text-muted-foreground">空集合</p>
                    )}
                    {col.items.map((item) => {
                      if (item.type !== 'request') return null;
                      const req = item.data;
                      return (
                        <div
                          key={req.id}
                          className="group flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-muted"
                          onClick={() => onLoadRequest(req)}
                        >
                          <span className={cn('w-8 shrink-0 text-[10px] font-bold', METHOD_COLORS[req.method])}>
                            {req.method}
                          </span>
                          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate text-xs">{req.name}</span>
                          <button
                            className="hidden p-0.5 group-hover:block"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromCollection(col.id, req.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-0.5">
            {history.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground">暂无历史记录</p>
            )}
            {history.map((entry) => (
              <div
                key={entry.id}
                className="group flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 hover:bg-muted"
                onClick={() => onLoadRequest(entry.request)}
              >
                <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                <span className={cn('w-8 shrink-0 text-[10px] font-bold', METHOD_COLORS[entry.request.method])}>
                  {entry.request.method}
                </span>
                <span className="flex-1 truncate text-xs text-muted-foreground">
                  {entry.request.url || '(无 URL)'}
                </span>
                {entry.response && (
                  <span
                    className={cn(
                      'text-[10px] font-medium',
                      entry.response.status < 400 ? 'text-green-500' : 'text-red-500'
                    )}
                  >
                    {entry.response.status}
                  </span>
                )}
                <button
                  className="hidden p-0.5 group-hover:block"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeHistory(entry.id);
                  }}
                >
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
