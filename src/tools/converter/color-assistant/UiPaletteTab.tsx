import { useState } from 'react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { allPalettes } from './color-data';

export default function UiPaletteTab() {
  const [activePalette, setActivePalette] = useState(3); // Default to Ant Design
  const palette = allPalettes[activePalette];

  const handleCopyColor = async (hex: string) => {
    await copyToClipboard(hex);
    toast.success(`已复制: ${hex}`);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Palette Tabs */}
      <div className="flex items-center gap-1 border-b px-4 py-2">
        {allPalettes.map((p, idx) => (
          <button
            key={p.name}
            onClick={() => setActivePalette(idx)}
            className={`px-3 py-1.5 text-sm rounded-t transition ${
              activePalette === idx
                ? 'border-b-2 border-primary text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Color Grid */}
      <div className="flex-1 overflow-auto p-4">
        {/* Column Headers */}
        <div className="grid grid-cols-[80px_repeat(10,1fr)] gap-0 mb-1">
          <div />
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="text-center text-xs text-muted-foreground py-1">{i + 1}</div>
          ))}
        </div>

        {/* Rows */}
        {palette.rows.map((row) => (
          <div key={row.name} className="grid grid-cols-[80px_repeat(10,1fr)] gap-0 mb-0.5">
            <div className="flex items-center text-sm text-muted-foreground pr-2">{row.name}</div>
            {row.colors.map((color, idx) => (
              <div
                key={idx}
                className="h-10 cursor-pointer transition-transform hover:scale-110 hover:z-10 hover:shadow-lg"
                style={{ backgroundColor: color }}
                title={`${color}`}
                onClick={() => handleCopyColor(color)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
