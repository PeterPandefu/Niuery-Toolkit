import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open } from '@tauri-apps/plugin-dialog';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Clipboard, Copy, File, FilePlus2, Folder, FolderOpen, FolderPlus, Link, LoaderCircle, MessageSquareText, Search, Share2, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface SharedItem { id: string; name: string; path: string; isDirectory: boolean; isText: boolean; content?: string | null; size: number; createdAt: number }
interface ServerInfo { url: string; port: number }
interface ShareAddress { interfaceName: string; address: string; isIpv6: boolean }

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function formatSize(size: number) {
  if (!size) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export default function FileShare() {
  const { t } = useTranslation();
  const [items, setItems] = useState<SharedItem[]>([]);
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [addresses, setAddresses] = useState<ShareAddress[]>([]);
  const [ipVersion, setIpVersion] = useState<'ipv4' | 'ipv6'>('ipv4');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [text, setText] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [textQuery, setTextQuery] = useState('');
  const [fileSort, setFileSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [textSort, setTextSort] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [serverQr, setServerQr] = useState('');
  const [qr, setQr] = useState<{ name: string; link: string; image: string } | null>(null);
  const fileItems = useMemo(() => {
    const compare = (sort: typeof fileSort) => (a: SharedItem, b: SharedItem) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    return items.filter((item) => !item.isText && item.name.toLocaleLowerCase().includes(fileQuery.trim().toLocaleLowerCase())).sort(compare(fileSort));
  }, [items, fileQuery, fileSort]);
  const textItems = useMemo(() => {
    const compare = (sort: typeof textSort) => (a: SharedItem, b: SharedItem) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    return items.filter((item) => item.isText && item.name.toLocaleLowerCase().includes(textQuery.trim().toLocaleLowerCase())).sort(compare(textSort));
  }, [items, textQuery, textSort]);
  const availableAddresses = useMemo(() => addresses.filter((address) => address.isIpv6 === (ipVersion === 'ipv6')), [addresses, ipVersion]);

  const refresh = async () => setItems(await invoke<SharedItem[]>('list_shared_items'));
  const refreshAddresses = async () => {
    const next = await invoke<ShareAddress[]>('list_file_share_addresses');
    setAddresses(next);
    return next;
  };

  useEffect(() => {
    if (!isTauri) return;
    void Promise.all([
      invoke<SharedItem[]>('list_shared_items').then(setItems),
      invoke<ServerInfo | null>('get_file_share_info').then(setServer),
      invoke<ShareAddress[]>('list_file_share_addresses').then(setAddresses),
    ]).catch((error) => toast.error(String(error)));
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen('file-share-updated', () => {
      void refresh().catch((error) => toast.error(String(error)));
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => toast.error(String(error)));
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop' || !event.payload.paths.length) return;
      void invoke<SharedItem[]>('add_shared_paths', { paths: event.payload.paths }).then(setItems).catch((error) => toast.error(`${t('fileShare.addFailed')}: ${String(error)}`));
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch((error) => toast.error(String(error)));
    return () => { disposed = true; unlisten?.(); };
  }, [t]);

  useEffect(() => {
    if (!availableAddresses.some((address) => address.address === selectedAddress)) {
      setSelectedAddress(availableAddresses[0]?.address ?? '');
    }
  }, [availableAddresses, selectedAddress]);

  useEffect(() => {
    if (!server) { setServerQr(''); return; }
    void QRCode.toDataURL(server.url, { width: 180, margin: 1 }).then(setServerQr).catch(() => setServerQr(''));
  }, [server]);

  const addPaths = async (directory: boolean) => {
    try {
      const selected = await open({ multiple: !directory, directory, title: t(directory ? 'fileShare.chooseFolder' : 'fileShare.chooseFiles') });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setItems(await invoke<SharedItem[]>('add_shared_paths', { paths }));
    } catch (error) { toast.error(`${t('fileShare.addFailed')}: ${String(error)}`); }
  };

  const startServer = async () => {
    setBusy(true);
    try {
      const latestAddresses = await refreshAddresses();
      const currentVersion = ipVersion === 'ipv6';
      const address = latestAddresses.find((value) => value.address === selectedAddress && value.isIpv6 === currentVersion)?.address
        ?? latestAddresses.find((value) => value.isIpv6 === currentVersion)?.address
        ?? '';
      if (!address) throw new Error(t('fileShare.noAddress'));
      setSelectedAddress(address);
      setServer(await invoke<ServerInfo>('start_file_share', { address }));
    }
    catch (error) { toast.error(`${t('fileShare.startFailed')}: ${String(error)}`); }
    finally { setBusy(false); }
  };

  const stopServer = async () => {
    setBusy(true);
    try { await invoke('stop_file_share'); setServer(null); }
    catch (error) { toast.error(String(error)); }
    finally { setBusy(false); }
  };

  const copyLink = async () => {
    if (!server) return;
    try { await navigator.clipboard.writeText(server.url); toast.success(t('fileShare.copied')); }
    catch { toast.error(t('fileShare.copyFailed')); }
  };

  const copyText = async (content: string) => {
    try { await navigator.clipboard.writeText(content); toast.success(t('fileShare.copied')); }
    catch { toast.error(t('fileShare.copyFailed')); }
  };

  const itemLink = (item: SharedItem) => server ? `${server.url}/api/download/${encodeURIComponent(item.id)}` : '';

  const showQr = async (item: SharedItem) => {
    if (!server) return;
    const link = itemLink(item);
    try { setQr({ name: item.name, link, image: await QRCode.toDataURL(link, { width: 200, margin: 1 }) }); }
    catch (error) { toast.error(String(error)); }
  };

  const revealItem = async (item: SharedItem) => {
    try { await invoke('reveal_shared_item', { id: item.id }); }
    catch (error) { toast.error(`${t('fileShare.revealFailed')}: ${String(error)}`); }
  };

  const renderSearch = (value: string, update: (value: string) => void, label: string) => (
    <label className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input type="search" value={value} onChange={(event) => update(event.target.value)} placeholder={label} aria-label={label} className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" /></label>
  );

  const renderSort = (value: typeof fileSort, update: (value: typeof fileSort) => void) => (
    <Select value={value} onChange={(event) => update(event.target.value as typeof fileSort)} options={[{ value: 'newest', label: t('fileShare.sortNewest') }, { value: 'oldest', label: t('fileShare.sortOldest') }, { value: 'name', label: t('fileShare.sortName') }]} className="h-9 min-w-36" aria-label={t('fileShare.sort')} />
  );

  const shareText = async () => {
    try { setItems(await invoke<SharedItem[]>('share_text', { text })); setText(''); setTextOpen(false); }
    catch (error) { toast.error(`${t('fileShare.shareTextFailed')}: ${String(error)}`); }
  };

  const remove = async (id: string) => {
    try {
      await invoke('remove_shared_item', { id });
      await refresh();
    } catch (error) { toast.error(`${t('fileShare.removeFailed')}: ${String(error)}`); }
  };

  const clear = async () => {
    try {
      await invoke('clear_shared_items');
      setItems([]);
    } catch (error) { toast.error(`${t('fileShare.clearFailed')}: ${String(error)}`); }
  };

  if (!isTauri) return (
    <div className="flex h-full items-center justify-center p-8">
      <section className="panel-raised max-w-lg p-6 text-center">
        <Share2 className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
        <h2 className="text-base font-semibold">{t('fileShare.desktopOnly')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('fileShare.desktopOnlyDesc')}</p>
      </section>
    </div>
  );

  return (
    <div className="h-full overflow-auto bg-background/45 p-3 sm:p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-5 md:space-y-6">
        <section className="panel-raised overflow-hidden border-primary/10 bg-card/95 p-4 shadow-tinted md:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className={cn('mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset', server ? 'bg-success/10 text-success ring-success/20' : 'bg-muted text-muted-foreground ring-border')}>
                <Share2 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">{t('fileShare.title')}</h2>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', server ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
                    {server ? t('fileShare.running', { port: server.port }) : t('fileShare.stopped')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t('fileShare.scanToOpen')}</p>
                {server && <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                  <code className="min-w-0 max-w-full flex-1 break-all rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs text-foreground/80">{server.url}</code>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={() => void copyLink()}><Clipboard />{t('fileShare.copyLink')}</Button>
                </div>}
              </div>
            </div>
            <Button className="min-h-11 w-full shrink-0 sm:min-h-9 sm:w-auto" variant={server ? 'outline' : 'default'} disabled={busy || (!server && !selectedAddress)} onClick={() => void (server ? stopServer() : startServer())}>
              {busy ? <LoaderCircle className="animate-spin" /> : server ? <X /> : <Share2 />}
              {server ? t('fileShare.stop') : t('fileShare.start')}
            </Button>
          </div>
          {!server && <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center">
            <div className="inline-flex w-full rounded-lg border border-border bg-muted/50 p-0.5 sm:w-auto" role="group" aria-label={t('fileShare.ipVersion')}>
              {(['ipv4', 'ipv6'] as const).map((version) => <Button key={version} size="sm" variant={ipVersion === version ? 'default' : 'ghost'} className="h-10 sm:h-8" onClick={() => setIpVersion(version)}>{t(`fileShare.${version}`)}</Button>)}
            </div>
            <Select
              value={selectedAddress}
              onChange={(event) => setSelectedAddress(event.target.value)}
              options={availableAddresses.map((address) => ({ value: address.address, label: `${address.interfaceName} · ${address.address}` }))}
              className="h-10 min-w-0 flex-1 sm:min-w-56"
              disabled={!availableAddresses.length}
              aria-label={t('fileShare.networkInterface')}
              placeholder={t('fileShare.selectAddress')}
              emptyText={t('fileShare.noAddress')}
            />
          </div>}
          {server && <div className="mt-5 flex flex-col items-start gap-4 border-t border-border/70 pt-5 sm:flex-row sm:items-center">
            {serverQr && <img src={serverQr} alt={t('fileShare.qrCode')} className="h-28 w-28 rounded-xl border border-border bg-white p-1 shadow-sm" />}
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">{t('fileShare.scanToOpen')}</p>
          </div>}
        </section>

        <section className="panel-raised overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
            <div><h2 className="text-base font-semibold tracking-tight">{t('fileShare.sharedFiles')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('fileShare.itemCount', { count: items.filter((item) => !item.isText).length })}</p></div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button size="sm" variant="outline" className="min-h-11 w-full sm:min-h-8" onClick={() => void addPaths(false)}><FilePlus2 />{t('fileShare.addFiles')}</Button>
              <Button size="sm" variant="outline" className="min-h-11 w-full sm:min-h-8" onClick={() => void addPaths(true)}><FolderPlus />{t('fileShare.addFolder')}</Button>
              <Button size="sm" variant="ghost" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" disabled={!items.length} onClick={() => void clear()} title={t('fileShare.clear')} aria-label={t('fileShare.clear')}><Trash2 /></Button>
            </div>
          </div>
          <div className="flex flex-col gap-2 border-b border-border bg-muted/20 px-4 py-3 sm:flex-row md:px-5">
            {renderSearch(fileQuery, setFileQuery, t('fileShare.search'))}
            <div className="sm:w-40">{renderSort(fileSort, setFileSort)}</div>
          </div>
          {fileItems.length ? <ul className="divide-y divide-border">
            {fileItems.map((item) => <li key={item.id} className="group flex min-w-0 flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/30 md:px-5 sm:flex-nowrap">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/10">{item.isDirectory ? <Folder className="h-4 w-4" /> : <File className="h-4 w-4" />}</span>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium" title={item.name}>{item.name}</div><div className="mt-1 text-xs text-muted-foreground">{item.isDirectory ? t('fileShare.folderZip') : formatSize(item.size)}</div></div>
              <div className="ml-[3.25rem] flex w-full items-center justify-end gap-1 sm:ml-0 sm:w-auto">
                <Button size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" disabled={!server} onClick={() => void showQr(item)} title={t('fileShare.itemLink')} aria-label={t('fileShare.itemLink')}><Link /></Button>
                <Button size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => void revealItem(item)} title={t('fileShare.reveal')} aria-label={t('fileShare.reveal')}><FolderOpen /></Button>
                <Button size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => void remove(item.id)} title={t('fileShare.remove')} aria-label={t('fileShare.remove')}><Trash2 /></Button>
              </div>
            </li>)}
          </ul> : <div className="px-4 py-10 text-center text-sm text-muted-foreground"><Upload className="mx-auto mb-3 h-6 w-6 opacity-50" />{items.some((item) => !item.isText) ? t('fileShare.noMatches') : t('fileShare.empty')}</div>}
        </section>

        <section className="panel-raised overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5">
            <div><h2 className="text-base font-semibold tracking-tight">{t('fileShare.sharedTexts')}</h2><p className="mt-1 text-xs text-muted-foreground">{t('fileShare.itemCount', { count: items.filter((item) => item.isText).length })}</p></div>
            <Button size="sm" variant="outline" className="min-h-11 w-full sm:min-h-8 sm:w-auto" onClick={() => setTextOpen(true)}><MessageSquareText />{t('fileShare.shareText')}</Button>
          </div>
          <div className="flex flex-col gap-2 border-b border-border bg-muted/20 px-4 py-3 sm:flex-row md:px-5">
            {renderSearch(textQuery, setTextQuery, t('fileShare.search'))}
            <div className="sm:w-40">{renderSort(textSort, setTextSort)}</div>
          </div>
          {textItems.length ? <ul className="divide-y divide-border">
            {textItems.map((item) => <li key={item.id} className="group flex min-w-0 flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/30 md:px-5 sm:flex-nowrap">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-inset ring-primary/10"><MessageSquareText className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium" title={item.name}>{item.name}</div><div className="mt-0.5 truncate text-xs text-muted-foreground">{item.content}</div></div>
              <div className="ml-[3.25rem] flex w-full items-center justify-end gap-1 sm:ml-0 sm:w-auto">
                {item.content != null && <Button size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => void copyText(item.content ?? '')} title={t('fileShare.copyText')} aria-label={t('fileShare.copyText')}><Copy /></Button>}
                <Button size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => void remove(item.id)} title={t('fileShare.remove')} aria-label={t('fileShare.remove')}><Trash2 /></Button>
              </div>
            </li>)}
          </ul> : <div className="px-4 py-10 text-center text-sm text-muted-foreground">{items.some((item) => item.isText) ? t('fileShare.noMatches') : t('fileShare.empty')}</div>}
        </section>
      </div>

      {textOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setTextOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="share-text-title" className="w-full max-w-lg rounded-md border border-border bg-background p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between"><h2 id="share-text-title" className="text-base font-semibold">{t('fileShare.shareText')}</h2><Button size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => setTextOpen(false)} aria-label={t('fileShare.close')}><X /></Button></div>
          <Textarea autoFocus rows={8} value={text} onChange={(event) => setText(event.target.value)} placeholder={t('fileShare.textPlaceholder')} />
          <div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => setTextOpen(false)}>{t('fileShare.cancel')}</Button><Button disabled={!text.trim()} onClick={() => void shareText()}>{t('fileShare.share')}</Button></div>
        </section>
      </div>}
      {qr && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setQr(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="file-share-qr-title" className="w-full max-w-sm rounded-md border border-border bg-background p-4 shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-3"><h2 id="file-share-qr-title" className="truncate text-base font-semibold">{qr.name}</h2><Button size="icon" variant="ghost" className="h-11 w-11 sm:h-9 sm:w-9" onClick={() => setQr(null)} aria-label={t('fileShare.close')}><X /></Button></div>
          <img src={qr.image} alt={t('fileShare.qrCode')} className="mx-auto h-48 w-48 border border-border bg-white p-1" />
          <code className="mt-3 block break-all rounded border border-border bg-muted/60 p-2 text-xs">{qr.link}</code>
          <div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => { void navigator.clipboard.writeText(qr.link).then(() => toast.success(t('fileShare.copied'))).catch(() => toast.error(t('fileShare.copyFailed'))); }}><Clipboard />{t('fileShare.copyLink')}</Button><Button onClick={() => setQr(null)}>{t('fileShare.close')}</Button></div>
        </section>
      </div>}
    </div>
  );
}
