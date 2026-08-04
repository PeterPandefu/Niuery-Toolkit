import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PrivacyNote } from '@/tools/pdf/common';
import {
  CompressPanel,
  ConvertPanel,
  CropPanel,
  FlipPanel,
  PaddingPanel,
  ResizePanel,
  RotatePanel,
  RoundedPanel,
  WatermarkPanel,
} from './panels-edit';
import { CutoutPanel, MergeGifPanel, MergeImagePanel, MergePdfPanel } from './panels-merge';
import {
  Crop,
  Eraser,
  Expand,
  FileStack,
  Film,
  FlipHorizontal,
  Layers,
  Maximize2,
  Minimize2,
  Radius,
  Repeat,
  RotateCw,
  Stamp,
} from 'lucide-react';

type FeatureId =
  | 'compress'
  | 'convert'
  | 'resize'
  | 'watermark'
  | 'rounded'
  | 'padding'
  | 'crop'
  | 'rotate'
  | 'flip'
  | 'merge-image'
  | 'merge-pdf'
  | 'merge-gif'
  | 'cutout';

interface Feature {
  id: FeatureId;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  desc: string;
}

const EDIT_FEATURES: Feature[] = [
  { id: 'compress', name: '图片压缩', icon: Minimize2, desc: '调整质量与目标体积，支持批量' },
  { id: 'convert', name: '格式转换', icon: Repeat, desc: 'PNG / JPEG / WebP 互转' },
  { id: 'resize', name: '修改尺寸', icon: Maximize2, desc: '按宽高缩放，可锁定比例' },
  { id: 'watermark', name: '添加水印', icon: Stamp, desc: '文字水印，支持平铺与旋转' },
  { id: 'rounded', name: '添加圆角', icon: Radius, desc: '为图片四角添加圆角' },
  { id: 'padding', name: '补边留白', icon: Expand, desc: '四周添加留白背景' },
  { id: 'crop', name: '裁剪', icon: Crop, desc: '按比例或自定义尺寸居中裁剪' },
  { id: 'rotate', name: '旋转', icon: RotateCw, desc: '任意角度旋转' },
  { id: 'flip', name: '翻转', icon: FlipHorizontal, desc: '水平 / 垂直翻转' },
];

const MERGE_FEATURES: Feature[] = [
  { id: 'merge-image', name: '合并为图片', icon: Layers, desc: '多张图片拼接为一张' },
  { id: 'merge-pdf', name: '合并为 PDF', icon: FileStack, desc: '每张图片作为 PDF 的一页' },
  { id: 'merge-gif', name: '合并为 GIF', icon: Film, desc: '多张图片合成动图' },
];

const CUTOUT_FEATURES: Feature[] = [
  { id: 'cutout', name: '手动裁剪', icon: Eraser, desc: '画笔涂抹抠图，输出透明背景 PNG' },
];

const PANELS: Record<FeatureId, React.ComponentType> = {
  compress: CompressPanel,
  convert: ConvertPanel,
  resize: ResizePanel,
  watermark: WatermarkPanel,
  rounded: RoundedPanel,
  padding: PaddingPanel,
  crop: CropPanel,
  rotate: RotatePanel,
  flip: FlipPanel,
  'merge-image': MergeImagePanel,
  'merge-pdf': MergePdfPanel,
  'merge-gif': MergeGifPanel,
  cutout: CutoutPanel,
};

function FeatureGroup({ title, features, active, onSelect }: { title: string; features: Feature[]; active: FeatureId; onSelect: (id: FeatureId) => void }) {
  return (
    <>
      <div className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</div>
      <div className="space-y-px">
        {features.map((feature) => {
          const Icon = feature.icon;
          const isActive = active === feature.id;
          return (
            <button
              key={feature.id}
              onClick={() => onSelect(feature.id)}
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
    </>
  );
}

/** 图片处理工具箱：单入口 + 内部左侧栏 */
export default function ImageStudio() {
  const [active, setActive] = useState<FeatureId>('compress');
  const ActivePanel = PANELS[active];
  const activeFeature = [...EDIT_FEATURES, ...MERGE_FEATURES, ...CUTOUT_FEATURES].find((f) => f.id === active)!;

  return (
    <div className="flex h-full">
      <aside className="w-44 shrink-0 overflow-y-auto border-r border-border bg-muted/20 p-2">
        <FeatureGroup title="图片编辑" features={EDIT_FEATURES} active={active} onSelect={setActive} />
        <FeatureGroup title="图片合并" features={MERGE_FEATURES} active={active} onSelect={setActive} />
        <FeatureGroup title="抠图" features={CUTOUT_FEATURES} active={active} onSelect={setActive} />
      </aside>

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
