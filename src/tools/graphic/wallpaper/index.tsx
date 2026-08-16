import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  Check,
  Download,
  FolderOpen,
  ImagePlus,
  Loader2,
  Monitor,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { isTauri } from '@/lib/api-client';
import { useToolLogger } from '@/hooks/use-tool-logger';
import {
  WALLHAVEN_CATEGORIES,
  WALLPAPER_SIZES,
  WALLPAPER_STYLES,
  buildAiPrompt,
  formatWallpaperResolution,
  getWallpaperSize,
  randomWallpaperSeed,
  type LocalWallpaper,
  type OnlineWallpaper,
  type WallpaperLibrary,
  type WallpaperSource,
  type WallpaperTab,
} from '@/lib/wallpaper-utils';

const EMPTY_LIBRARY: WallpaperLibrary = { items: [] };

function previewSrc(path: string): string {
  if (!isTauri) return path;
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

function sourceLabel(source: WallpaperSource | string): string {
  switch (source) {
    case 'bing':
      return '必应';
    case 'wallhaven':
      return 'Wallhaven';
    case 'ai':
      return 'AI';
    case 'import':
      return '导入';
    default:
      return source;
  }
}

export default function WallpaperTool() {
  const log = useToolLogger('wallpaper');
  const [tab, setTab] = useState<WallpaperTab>('online');
  const [onlineSource, setOnlineSource] = useState<'bing' | 'wallhaven'>('bing');
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [page, setPage] = useState(1);
  const [online, setOnline] = useState<OnlineWallpaper[]>([]);
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [library, setLibrary] = useState<WallpaperLibrary>(EMPTY_LIBRARY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [prompt, setPrompt] = useState('清晨山间云海，金色阳光穿过松林');
  const [styleId, setStyleId] = useState('scenic');
  const [sizeId, setSizeId] = useState('1080p');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<LocalWallpaper | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => library.items.find((item) => item.id === selectedId) ?? null,
    [library.items, selectedId]
  );

  const refreshLibrary = useCallback(async () => {
    if (!isTauri) return EMPTY_LIBRARY;
    const next = await invoke<WallpaperLibrary>('list_local_wallpapers');
    setLibrary(next);
    return next;
  }, []);

  const searchOnline = useCallback(
    async (nextPage = 1, nextQuery = query) => {
      if (!isTauri) return;
      setOnlineLoading(true);
      try {
        log.info('检索在线壁纸', { source: onlineSource, page: nextPage, query: nextQuery });
        const items = await invoke<OnlineWallpaper[]>('search_online_wallpapers', {
          source: onlineSource,
          query: nextQuery,
          page: nextPage,
        });
        setOnline(items);
        setPage(nextPage);
        log.info('检索完成', { count: items.length });
      } catch (error) {
        log.error('检索在线壁纸失败', error);
        toast.error(error instanceof Error ? error.message : '检索壁纸失败');
      } finally {
        setOnlineLoading(false);
      }
    },
    [log, onlineSource, query]
  );

  useEffect(() => {
    void refreshLibrary().then((next) => {
      if (next.currentId) setSelectedId(next.currentId);
    });
  }, [refreshLibrary]);

  useEffect(() => {
    void searchOnline(1, onlineSource === 'bing' ? '' : query);
    // 切换来源时重新拉取第一页
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineSource]);

  const applyLibrary = useCallback((next: WallpaperLibrary, selectId?: string) => {
    setLibrary(next);
    if (selectId) setSelectedId(selectId);
    else if (next.currentId) setSelectedId(next.currentId);
  }, []);

  const downloadOnline = useCallback(
    async (item: OnlineWallpaper, alsoSet: boolean) => {
      if (!isTauri) {
        toast.error('下载与设为壁纸需要在桌面应用中使用');
        return;
      }
      setBusyId(item.id);
      try {
        log.info('下载壁纸', { id: item.id, source: item.source, set: alsoSet });
        const saved = await invoke<LocalWallpaper>('download_online_wallpaper', {
          url: item.fullUrl,
          title: item.title,
          source: item.source,
          remoteId: item.id,
        });
        let next = await refreshLibrary();
        if (alsoSet) {
          next = await invoke<WallpaperLibrary>('set_desktop_wallpaper', { id: saved.id });
          toast.success('已设为系统壁纸');
          log.info('已设为系统壁纸', { id: saved.id });
        } else {
          toast.success('已保存到本地壁纸库');
        }
        applyLibrary(next, saved.id);
      } catch (error) {
        log.error('下载壁纸失败', error);
        toast.error(error instanceof Error ? error.message : '下载壁纸失败');
      } finally {
        setBusyId(null);
      }
    },
    [applyLibrary, log, refreshLibrary]
  );

  const setAsWallpaper = useCallback(
    async (id: string) => {
      if (!isTauri) {
        toast.error('设为系统壁纸仅在桌面端可用');
        return;
      }
      setBusyId(id);
      try {
        const next = await invoke<WallpaperLibrary>('set_desktop_wallpaper', { id });
        applyLibrary(next, id);
        toast.success('已设为系统壁纸');
        log.info('已设为系统壁纸', { id });
      } catch (error) {
        log.error('设置壁纸失败', error);
        toast.error(error instanceof Error ? error.message : '设置壁纸失败');
      } finally {
        setBusyId(null);
      }
    },
    [applyLibrary, log]
  );

  const removeWallpaper = useCallback(
    async (id: string) => {
      if (!isTauri) return;
      setBusyId(id);
      try {
        const next = await invoke<WallpaperLibrary>('delete_local_wallpaper', { id });
        applyLibrary(next, next.items[0]?.id);
        if (generated?.id === id) setGenerated(null);
        toast.success('已从本地库移除');
        log.info('删除本地壁纸', { id });
      } catch (error) {
        log.error('删除壁纸失败', error);
        toast.error(error instanceof Error ? error.message : '删除失败');
      } finally {
        setBusyId(null);
      }
    },
    [applyLibrary, generated?.id, log]
  );

  const handleGenerate = useCallback(async () => {
    if (!isTauri) {
      toast.error('AI 生成需要在桌面应用中使用');
      return;
    }
    const fullPrompt = buildAiPrompt(prompt, styleId);
    if (!prompt.trim()) {
      toast.error('请输入壁纸描述');
      return;
    }
    const size = getWallpaperSize(sizeId);
    setGenerating(true);
    try {
      log.info('开始 AI 生成壁纸（自动去水印）', {
        width: size.width,
        height: size.height,
        style: styleId,
      });
      const item = await invoke<LocalWallpaper>('generate_ai_wallpaper', {
        prompt: fullPrompt,
        width: size.width,
        height: size.height,
        model: styleId === 'anime' ? 'flux-anime' : 'flux',
        seed: randomWallpaperSeed(),
      });
      setGenerated(item);
      const next = await refreshLibrary();
      applyLibrary(next, item.id);
      toast.success('壁纸已生成并去掉水印');
      log.info('AI 壁纸生成成功', { id: item.id, path: item.path });
    } catch (error) {
      log.error('AI 生成失败', error);
      toast.error(error instanceof Error ? error.message : '生成失败，请稍后重试');
    } finally {
      setGenerating(false);
    }
  }, [applyLibrary, log, prompt, refreshLibrary, sizeId, styleId]);

  const handleImport = useCallback(
    async (file: File) => {
      if (!isTauri) {
        toast.error('导入壁纸需要在桌面应用中使用');
        return;
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      try {
        const saved = await invoke<LocalWallpaper>('import_wallpaper', {
          bytes: buf,
          title: file.name.replace(/\.[^.]+$/, ''),
        });
        const next = await refreshLibrary();
        applyLibrary(next, saved.id);
        setTab('library');
        toast.success('已导入到本地壁纸库');
        log.info('导入本地图片', { id: saved.id, name: file.name });
      } catch (error) {
        log.error('导入失败', error);
        toast.error(error instanceof Error ? error.message : '导入失败');
      }
    },
    [applyLibrary, log, refreshLibrary]
  );

  const tabs: { id: WallpaperTab; label: string; icon: typeof Monitor }[] = [
    { id: 'online', label: '在线壁纸', icon: Download },
    { id: 'ai', label: 'AI 生成', icon: Sparkles },
    { id: 'library', label: '本地库', icon: Monitor },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-2">
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <Button
              key={item.id}
              size="sm"
              variant={active ? 'default' : 'ghost'}
              onClick={() => setTab(item.id)}
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </Button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          {isTauri && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => invoke('reveal_wallpaper_folder').catch(() => toast.error('无法打开目录'))}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              打开目录
            </Button>
          )}
        </div>
      </div>
      {!isTauri && (
        <div className="border-b border-border/70 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
          下载、AI 生成和设为系统壁纸需要在桌面应用中使用。
        </div>
      )}

      {tab === 'online' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <Select
              className="h-8 w-36"
              value={onlineSource}
              onChange={(e) => {
                setOnlineSource(e.target.value as 'bing' | 'wallhaven');
                setActiveCategory('');
                setQuery('');
              }}
              options={[
                { value: 'bing', label: '必应每日' },
                { value: 'wallhaven', label: 'Wallhaven' },
              ]}
            />
            {onlineSource === 'wallhaven' && (
              <>
                <Input
                  className="h-8 max-w-xs"
                  placeholder="搜索关键词，回车检索"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setActiveCategory('');
                      void searchOnline(1, query);
                    }
                  }}
                />
                <Button size="sm" onClick={() => void searchOnline(1, query)} disabled={onlineLoading}>
                  搜索
                </Button>
              </>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              {onlineLoading ? '加载中…' : `${online.length} 张`}
            </div>
          </div>
          {onlineSource === 'wallhaven' && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {WALLHAVEN_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setActiveCategory(cat.id);
                    setQuery(cat.query);
                    void searchOnline(1, cat.query);
                  }}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                    activeCategory === cat.id
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}
          <WallpaperGrid loading={onlineLoading}>
            {online.map((item) => (
              <OnlineCard
                key={`${item.source}-${item.id}`}
                item={item}
                busy={busyId === item.id}
                onDownload={() => void downloadOnline(item, false)}
                onSet={() => void downloadOnline(item, true)}
              />
            ))}
          </WallpaperGrid>
          <div className="flex items-center justify-center gap-2 border-t border-border/60 px-4 py-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1 || onlineLoading}
              onClick={() => void searchOnline(page - 1, query)}
            >
              上一页
            </Button>
            <span className="text-xs text-muted-foreground">第 {page} 页</span>
            <Button
              size="sm"
              variant="outline"
              disabled={onlineLoading || online.length === 0}
              onClick={() => void searchOnline(page + 1, query)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[280px_1fr]">
          <div className="flex min-h-0 flex-col gap-3 overflow-auto border-b border-border/70 p-4 lg:border-b-0 lg:border-r">
            <p className="text-xs leading-5 text-muted-foreground">
              使用 AI 生成桌面壁纸，请求时关闭 Logo，并裁掉底部水印条后保存。
            </p>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想要的壁纸，例如：雨夜霓虹城市、极简山峦剪影…"
              className="min-h-[120px]"
            />
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                风格
              </span>
              <div className="flex flex-wrap gap-1.5">
                {WALLPAPER_STYLES.map((style) => (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setStyleId(style.id)}
                    className={cn(
                      'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                      styleId === style.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {style.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                分辨率
              </span>
              <Select
                className="h-8"
                value={sizeId}
                onChange={(e) => setSizeId(e.target.value)}
                options={WALLPAPER_SIZES.map((size) => ({ value: size.id, label: size.label }))}
              />
            </div>
            <Button onClick={() => void handleGenerate()} disabled={generating || !prompt.trim()}>
              {generating ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {generating ? '正在生成并去水印…' : '生成壁纸'}
            </Button>
          </div>
          <div className="flex min-h-0 flex-col p-4">
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/20">
              {generating && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/70 text-sm text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  生成中，完成后会自动去掉水印
                </div>
              )}
              {generated ? (
                <img
                  src={previewSrc(generated.path)}
                  alt={generated.title}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="px-6 text-center text-sm text-muted-foreground">
                  生成结果会显示在这里，可直接设为系统壁纸
                </div>
              )}
            </div>
            {generated && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {generated.title} · {formatWallpaperResolution(generated.width, generated.height)}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => void setAsWallpaper(generated.id)} disabled={busyId === generated.id}>
                    {busyId === generated.id ? <Loader2 className="animate-spin" /> : <Check />}
                    设为壁纸
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void handleGenerate()} disabled={generating}>
                    再生成一张
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'library' && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2">
            <input
              ref={importRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void handleImport(file);
              }}
            />
            <Button size="sm" variant="outline" onClick={() => importRef.current?.click()}>
              <ImagePlus className="h-3.5 w-3.5" />
              导入本地图片
            </Button>
            <span className="text-xs text-muted-foreground">{library.items.length} 张本地壁纸</span>
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                disabled={!selected}
                onClick={() => selected && void setAsWallpaper(selected.id)}
              >
                <Check className="h-3.5 w-3.5" />
                设为壁纸
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!selected}
                onClick={() => selected && void removeWallpaper(selected.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除
              </Button>
            </div>
          </div>
          <WallpaperGrid loading={false} empty="还没有本地壁纸，先去在线下载或用 AI 生成一张。">
            {library.items.map((item) => (
              <LocalCard
                key={item.id}
                item={item}
                selected={selectedId === item.id}
                current={library.currentId === item.id}
                busy={busyId === item.id}
                onSelect={() => setSelectedId(item.id)}
                onSet={() => void setAsWallpaper(item.id)}
                onDelete={() => void removeWallpaper(item.id)}
              />
            ))}
          </WallpaperGrid>
        </div>
      )}
    </div>
  );
}

function WallpaperGrid({
  children,
  loading,
  empty = '没有找到壁纸',
}: {
  children: ReactNode;
  loading: boolean;
  empty?: string;
}) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
      {loading && !hasChildren ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          加载中…
        </div>
      ) : hasChildren ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{children}</div>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{empty}</div>
      )}
    </div>
  );
}

function OnlineCard({
  item,
  busy,
  onDownload,
  onSet,
}: {
  item: OnlineWallpaper;
  busy: boolean;
  onDownload: () => void;
  onSet: () => void;
}) {
  return (
    <article className="group relative overflow-hidden rounded-lg border border-border bg-muted/20">
      <div className="aspect-video overflow-hidden bg-muted">
        <img src={item.thumbUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
      </div>
      <div className="space-y-1 px-2.5 py-2">
        <p className="truncate text-xs font-medium" title={item.title}>
          {item.title}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {sourceLabel(item.source)} · {formatWallpaperResolution(item.width, item.height)}
        </p>
      </div>
      <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-black/70 via-black/10 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex w-full gap-1.5">
          <Button size="sm" variant="secondary" className="h-7 flex-1 text-xs" disabled={busy} onClick={onDownload}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />}
            下载
          </Button>
          <Button size="sm" className="h-7 flex-1 text-xs" disabled={busy} onClick={onSet}>
            {busy ? <Loader2 className="animate-spin" /> : <Monitor />}
            设为壁纸
          </Button>
        </div>
      </div>
    </article>
  );
}

function LocalCard({
  item,
  selected,
  current,
  busy,
  onSelect,
  onSet,
  onDelete,
}: {
  item: LocalWallpaper;
  selected: boolean;
  current: boolean;
  busy: boolean;
  onSelect: () => void;
  onSet: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      className={cn(
        'group relative overflow-hidden rounded-lg border bg-muted/20 transition-colors',
        selected ? 'border-primary ring-1 ring-primary/40' : 'border-border'
      )}
    >
      <button type="button" className="block w-full text-left" onClick={onSelect}>
        <div className="aspect-video overflow-hidden bg-muted">
          <img src={previewSrc(item.path)} alt={item.title} className="h-full w-full object-cover" />
        </div>
        <div className="space-y-1 px-2.5 py-2">
          <p className="truncate text-xs font-medium" title={item.title}>
            {item.title}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {sourceLabel(item.source)}
            {current ? ' · 当前桌面' : ''} · {formatWallpaperResolution(item.width, item.height)}
          </p>
        </div>
      </button>
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button size="icon" className="h-7 w-7" disabled={busy} onClick={onSet} title="设为壁纸">
          {busy ? <Loader2 className="animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </Button>
        <Button size="icon" variant="secondary" className="h-7 w-7" disabled={busy} onClick={onDelete} title="删除">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  );
}
