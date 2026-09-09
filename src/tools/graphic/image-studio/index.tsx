import { useState, type ComponentType } from 'react';
import { FeatureRail } from '@/components/shared/FeatureRail';
import { useToolLogger } from '@/hooks/use-tool-logger';
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
import { OcrPanel } from './ocr-panel';
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
  ScanText,
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
  | 'ocr'
  | 'merge-image'
  | 'merge-pdf'
  | 'merge-gif'
  | 'cutout';

interface Feature {
  id: FeatureId;
  name: string;
  icon: ComponentType<{ className?: string }>;
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
  { id: 'ocr', name: '图片 OCR', icon: ScanText, desc: '本地识别图片中的简体中文和英文文字' },
];

const MERGE_FEATURES: Feature[] = [
  { id: 'merge-image', name: '合并为图片', icon: Layers, desc: '多张图片拼接为一张' },
  { id: 'merge-pdf', name: '合并为 PDF', icon: FileStack, desc: '每张图片作为 PDF 的一页' },
  { id: 'merge-gif', name: '合并为 GIF', icon: Film, desc: '多张图片合成动图' },
];

const CUTOUT_FEATURES: Feature[] = [
  { id: 'cutout', name: '手动裁剪', icon: Eraser, desc: '画笔涂抹抠图，输出透明背景 PNG' },
];

const PANELS: Record<FeatureId, ComponentType> = {
  compress: CompressPanel,
  convert: ConvertPanel,
  resize: ResizePanel,
  watermark: WatermarkPanel,
  rounded: RoundedPanel,
  padding: PaddingPanel,
  crop: CropPanel,
  rotate: RotatePanel,
  flip: FlipPanel,
  ocr: OcrPanel,
  'merge-image': MergeImagePanel,
  'merge-pdf': MergePdfPanel,
  'merge-gif': MergeGifPanel,
  cutout: CutoutPanel,
};

/** 图片处理工具箱：顶部功能分段 + 预览/属性工作台 */
export default function ImageStudio() {
  const log = useToolLogger('image-studio');
  const [active, setActive] = useState<FeatureId>('compress');
  const activeFeature = [...EDIT_FEATURES, ...MERGE_FEATURES, ...CUTOUT_FEATURES].find((f) => f.id === active)!;

  const handleSelect = (id: FeatureId) => {
    if (id === active) return;
    setActive(id);
    log.info('功能标签切换', { id });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FeatureRail
        ariaLabel="图片操作"
        active={active}
        onSelect={handleSelect}
        groups={[
          { title: '图片编辑', features: EDIT_FEATURES },
          { title: '图片合并', features: MERGE_FEATURES },
          { title: '抠图', features: CUTOUT_FEATURES },
        ]}
      />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">
        <header className="mb-4">
          <h2 className="text-base font-semibold">{activeFeature.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{activeFeature.desc}</p>
        </header>
        {Object.entries(PANELS).map(([id, Panel]) => (
          <div key={id} className={id === active ? 'block' : 'hidden'} aria-hidden={id !== active}>
            <Panel />
          </div>
        ))}
        <PrivacyNote />
      </main>
    </div>
  );
}
