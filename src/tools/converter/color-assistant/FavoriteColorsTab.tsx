import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils';

interface FavoriteColorsTabProps {
  favorites: string[];
  onRemove: (hex: string) => void;
}

export default function FavoriteColorsTab({ favorites, onRemove }: FavoriteColorsTabProps) {
  const handleCopyColor = async (hex: string) => {
    await copyToClipboard(hex);
    toast.success(`已复制: ${hex}`);
  };

  if (favorites.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg mb-2">暂无收藏颜色</p>
          <p className="text-sm">在颜色选择器中点击 + 按钮添加收藏</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className="grid grid-cols-6 gap-3">
        {favorites.map((color, idx) => (
          <div key={`${color}-${idx}`} className="group relative">
            <div
              className="h-20 w-full rounded-lg cursor-pointer border shadow-sm transition-transform hover:scale-105"
              style={{ backgroundColor: color }}
              onClick={() => handleCopyColor(color)}
              title={color}
            />
            <div className="mt-1 text-center text-xs font-mono text-muted-foreground">{color}</div>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(color); }}
              className="absolute -top-1.5 -right-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-destructive text-white shadow group-hover:flex"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
