import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { isResourceDesktop } from '@/lib/resources';
import { useResourceStore, useResourceEvents } from '@/store/resource-store';

const TITLES = { chromium: 'Chromium', ffmpeg: 'FFmpeg', java: 'Java', plantuml: 'PlantUML', 'ocr-engine': 'OCR', 'ocr-chi-sim': 'OCR · 简体中文', 'ocr-eng': 'OCR · English' };
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
export function ResourceManager() {
  const { i18n } = useTranslation();
  const zh = (i18n.language || 'zh').startsWith('zh');
  const { resources, refresh, loading, error, run, busy, progress, errors } = useResourceStore();
  useResourceEvents();
  const [mirror, setMirror] = useState('');
  const [mirrorMessage, setMirrorMessage] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  useEffect(() => {
    if (!isResourceDesktop()) return;
    void refresh();
    void invoke<string>('get_resource_mirror').then(setMirror).catch(e => setMirrorMessage(String(e)));
  }, [refresh]);
  if (!isResourceDesktop()) return <p className="p-4 text-sm text-muted-foreground">{zh ? '本机资源管理仅在桌面版可用。网页端沿用浏览器资源。' : 'Local resource management is available in the desktop app.'}</p>;
  return <section className="space-y-4 p-2" aria-label={zh ? '资源管理' : 'Resources'}>
    <div className="flex items-start justify-between gap-2"><p className="text-xs text-muted-foreground">{zh ? '只在点击下载时联网。准备后离线运行，文档不上传；本机资源会先验证兼容性。' : 'Downloads require your action. Prepared resources run offline; documents stay local. Local programs are checked for compatibility.'}</p><Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>{zh ? '重新检测' : 'Refresh'}</Button></div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {resources.map(resource => {
      const id = resource.id; const task = progress[id]; const pending = busy[id] || !!task; const ready = resource.status === 'ready';
      const usage = id === 'chromium' ? (zh ? 'Markdown、HTML、报告、图表的 PDF/PNG 导出' : 'Markdown, HTML, report and diagram PDF/PNG exports') : id === 'ffmpeg' ? (zh ? '录屏、MP4 与 GIF 导出' : 'Recording, MP4 and GIF export') : id === 'java' || id === 'plantuml' ? (zh ? 'PlantUML 预览与导出' : 'PlantUML preview and export') : (zh ? '图片和截图文字识别' : 'Image and screenshot OCR');
      return <article key={id} className="space-y-2 rounded-lg border border-border p-3">
        <header className="flex justify-between gap-2"><h3 className="text-sm font-semibold">{TITLES[id]} <span className="font-mono text-[10px] font-normal text-muted-foreground">{resource.version}</span></h3><span className={ready ? 'text-xs text-success' : 'text-xs text-warning'}>{ready ? (zh ? '可用' : 'Ready') : (zh ? '未准备' : 'Not ready')}</span></header>
        <p className="text-xs text-muted-foreground">{usage}</p>
        <p className="text-[11px] text-muted-foreground">{zh ? '下载' : 'Download'} {mb(resource.downloadBytes)} · {zh ? '安装后' : 'Installed'} {mb(resource.installedBytes)} · {resource.source ?? (zh ? '项目 GitHub Releases / 已配置镜像' : 'Project GitHub Releases / configured mirror')}</p>
        {resource.path && <p className="break-all font-mono text-[10px] text-muted-foreground">{resource.path}</p>}
        {task && <div role="status"><p className="text-xs">{task.phase} · {mb(task.received)} / {mb(task.total)}</p><progress className="w-full" value={task.received} max={task.total || 1} /></div>}
        {errors[id] && <p role="alert" className="break-words text-xs text-destructive">{errors[id]}</p>}
        {!ready && resource.error && <p className="break-words text-xs text-warning">{resource.error.replace(/^RESOURCE_REQUIRED:[^:]+:\s*/, '')}</p>}
        <div className="flex flex-wrap gap-2">
          {pending ? <Button size="sm" variant="outline" onClick={() => void invoke('cancel_resource_download', { id }).catch(e => setMirrorMessage(String(e)))}>{zh ? '取消' : 'Cancel'}</Button> : <>
            <Button size="sm" onClick={() => void run(id, 'install_resource')}>{resource.managed ? (zh ? '修复 / 重新下载' : 'Repair / download') : (zh ? '下载' : 'Download')}</Button>
            <Button size="sm" variant="outline" onClick={() => void run(id, 'import_resource')}>{zh ? '离线导入' : 'Offline import'}</Button>
            {['ffmpeg', 'chromium', 'java'].includes(id) && <Button size="sm" variant="outline" onClick={() => void run(id, 'select_local_resource', { clear: false })}>{zh ? '选择本机程序' : 'Select local program'}</Button>}
            {resource.source === 'local' && <Button size="sm" variant="outline" onClick={() => void run(id, 'select_local_resource', { clear: true })}>{zh ? '恢复自动检测' : 'Use auto detection'}</Button>}
            {resource.managed && <Button size="sm" variant="outline" onClick={() => setConfirmRemove(id)}>{zh ? '移除下载资源' : 'Remove managed files'}</Button>}
          </>}
        </div>
        {confirmRemove === id && <div className="space-y-2 rounded-md bg-muted p-2 text-xs"><p>{zh ? '移除此应用下载的资源？依赖它的功能将需要重新下载，不会删除本机外部程序。' : 'Remove app-managed files? Dependent features may need another download. External programs are not deleted.'}</p><div className="flex gap-2"><Button size="sm" variant="destructive" onClick={() => { setConfirmRemove(null); void run(id, 'remove_resource'); }}>{zh ? '确认移除' : 'Confirm removal'}</Button><Button size="sm" variant="outline" onClick={() => setConfirmRemove(null)}>{zh ? '取消' : 'Cancel'}</Button></div></div>}
      </article>;
    })}
    <form className="space-y-2 border-t border-border pt-3" onSubmit={event => { event.preventDefault(); setMirrorMessage(''); void invoke('set_resource_mirror', { url: mirror.trim() }).then(() => setMirrorMessage(zh ? '已保存' : 'Saved')).catch(e => setMirrorMessage(String(e))); }}>
      <label className="block text-xs" htmlFor="resource-mirror">{zh ? '资源镜像目录（HTTPS，留空使用 GitHub Releases）' : 'Mirror directory (HTTPS, empty uses GitHub Releases)'}</label>
      <input id="resource-mirror" className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs" value={mirror} onChange={e => setMirror(e.target.value)} placeholder="https://example.com/resources-v1" />
      <p className="text-[11px] text-muted-foreground">{zh ? '镜像必须提供相同文件；始终按程序内置 SHA-256 校验。更新资源版本随应用目录发布，不自动替换。' : 'Mirrors must serve identical files verified against the embedded SHA-256. Resource versions update with the app catalog, never silently.'}</p>
      <Button size="sm" variant="outline" type="submit">{zh ? '保存下载源' : 'Save source'}</Button>{mirrorMessage && <p role="status" className="break-words text-xs">{mirrorMessage}</p>}
    </form>
  </section>;
}
