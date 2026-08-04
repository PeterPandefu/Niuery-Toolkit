import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PrivacyNote } from './common';
import { CompressPanel, ExtractImagesPanel, MergePanel, SplitPanel, ToImagesPanel, WatermarkPanel } from './panels';
import { Combine, ImageDown, Images, Minimize2, Scissors, Stamp } from 'lucide-react';

type FeatureId = 'compress' | 'merge' | 'split' | 'watermark' | 'extract-images' | 'to-images';

const FEATURES: { id: FeatureId; name: string; icon: React.ComponentType<{ className?: string }>; desc: string }[] = [
  { id: 'compress', name: 'PDF 压缩', icon: Minimize2, desc: '无损重压缩或栅格化激进压缩' },
  { id: 'merge', name: 'PDF 合并', icon: Combine, desc: '多个 PDF 按顺序合并为一个' },
  { id: 'split', name: 'PDF 拆分', icon: Scissors, desc: '按页范围拆分或每页独立成文件' },
  { id: 'watermark', name: 'PDF 水印', icon: Stamp, desc: '文字水印，支持平铺与旋转' },
  { id: 'extract-images', name: '提取图片', icon: ImageDown, desc: '提取 PDF 内嵌的位图图片' },
  { id: 'to-images', name: 'PDF 转图片', icon: Images, desc: '每页渲染为 PNG / JPEG' },
];

const PANELS: Record<FeatureId, React.ComponentType> = {
  compress: CompressPanel,
  merge: MergePanel,
  split: SplitPanel,
  watermark: WatermarkPanel,
  'extract-images': ExtractImagesPanel,
  'to-images': ToImagesPanel,
};

/** PDF 工具箱：单入口 + 内部左侧栏 */
export default function PdfToolkit() {
  const [active, setActive] = useState<FeatureId>('compress');
  const ActivePanel = PANELS[active];
  const activeFeature = FEATURES.find((f) => f.id === active)!;

  return (
    <div className="flex h-full">
      {/* 内部侧栏 */}
      <aside className="w-44 shrink-0 overflow-y-auto border-r border-border bg-muted/20 p-2">
        <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          PDF 操作
        </div>
        <div className="space-y-px">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            const isActive = active === feature.id;
            return (
              <button
                key={feature.id}
                onClick={() => setActive(feature.id)}
                className={cn(
                  'group relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] transition-all duration-150',
                  'hover:bg-accent hover:translate-x-[2px]',
                  isActive ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span
                  className={cn(
                    'absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-200',
                    isActive ? 'opacity-100 scale-y-100' : 'opacity-0 scale-y-50'
                  )}
                />
                <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                <span className="truncate">{feature.name}</span>
              </button>
            );
          })}
        </div>
      </aside>

      {/* 主区域 */}
      <main className="min-w-0 flex-1 overflow-y-auto p-5">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          <header>
            <h2 className="text-base font-semibold">{activeFeature.name}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{activeFeature.desc}</p>
          </header>
          <ActivePanel />
          <PrivacyNote />
        </div>
      </main>
    </div>
  );
}
