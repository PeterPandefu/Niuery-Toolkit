import { useState, useMemo } from 'react';
import { toast } from 'sonner';
import { copyToClipboard } from '@/lib/utils';
import { chineseTraditionalColors, japaneseTraditionalColors, colorFilterDots } from './color-data';

export default function TraditionalColorTab() {
  const [activeTab, setActiveTab] = useState<'chinese' | 'japanese'>('chinese');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<number | null>(null);

  const filteredChinese = useMemo(() => {
    if (!search) return chineseTraditionalColors;
    return chineseTraditionalColors.map(term => ({
      ...term,
      colors: term.colors.filter(c => c.name.includes(search)),
    })).filter(term => term.colors.length > 0);
  }, [search]);

  const filteredJapanese = useMemo(() => {
    if (!search) return japaneseTraditionalColors;
    return japaneseTraditionalColors.filter(c => c.name.includes(search));
  }, [search]);

  const handleCopyColor = async (hex: string) => {
    await copyToClipboard(hex);
    toast.success(`已复制: ${hex}`);
  };

  // Simple hue-based filter
  const matchesFilter = (hex: string, filterIdx: number): boolean => {
    if (filterIdx === null) return true;
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0;
    if (max !== min) {
      const d = max - min;
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
        case g: h = ((b - r) / d + 2) * 60; break;
        case b: h = ((r - g) / d + 4) * 60; break;
      }
    }
    // Map filter dots to hue ranges
    const ranges = [
      [330, 30],   // red/pink
      [15, 45],    // orange
      [45, 70],    // yellow
      [70, 170],   // green
      [170, 250],  // blue
      [160, 200],  // teal
      [250, 330],  // purple
      [0, 360],    // light gray (low sat)
      [0, 360],    // gray (low sat)
      [0, 360],    // dark (low lightness)
    ];
    const sat = max === 0 ? 0 : (max - min) / max;
    const light = (max + min) / 2;
    if (filterIdx === 7 && sat < 0.1 && light > 0.7) return true;
    if (filterIdx === 8 && sat < 0.1 && light > 0.3 && light <= 0.7) return true;
    if (filterIdx === 9 && light < 0.3) return true;
    if (filterIdx >= 7) return false;
    const [lo, hi] = ranges[filterIdx];
    if (lo > hi) return h >= lo || h <= hi;
    return h >= lo && h <= hi;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center gap-4 border-b px-4 py-2">
        <button
          onClick={() => setActiveTab('chinese')}
          className={`text-sm pb-1 ${activeTab === 'chinese' ? 'border-b-2 border-primary text-primary font-medium' : 'text-muted-foreground'}`}
        >
          中国传统色 · 故宫 24 节气
        </button>
        <button
          onClick={() => setActiveTab('japanese')}
          className={`text-sm pb-1 ${activeTab === 'japanese' ? 'border-b-2 border-primary text-primary font-medium' : 'text-muted-foreground'}`}
        >
          日本传统色
        </button>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-4 px-4 py-2 border-b">
        <input
          type="text"
          placeholder="名称搜索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-40 rounded border bg-background px-3 py-1.5 text-sm"
        />
        <div className="flex items-center gap-2">
          {colorFilterDots.map((color, idx) => (
            <button
              key={idx}
              onClick={() => setActiveFilter(activeFilter === idx ? null : idx)}
              className={`h-5 w-5 rounded-full border-2 transition ${activeFilter === idx ? 'border-foreground scale-125' : 'border-transparent'}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'chinese' ? (
          <div className="space-y-8">
            {filteredChinese.map((term) => (
              <div key={term.term}>
                <h3 className="text-2xl font-bold mb-3">{term.term}</h3>
                <div className="grid grid-cols-4 gap-0">
                  {term.colors
                    .filter(c => activeFilter === null || matchesFilter(c.hex, activeFilter))
                    .map((color) => (
                    <div
                      key={color.name}
                      className="p-3 cursor-pointer transition-opacity hover:opacity-80"
                      style={{ backgroundColor: color.hex }}
                      onClick={() => handleCopyColor(color.hex)}
                    >
                      <div className="text-sm font-medium" style={{ color: getContrastText(color.hex) }}>
                        {color.name}
                      </div>
                      <div className="text-xs font-mono" style={{ color: getContrastText(color.hex) }}>
                        {color.hex}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-0">
            {filteredJapanese
              .filter(c => activeFilter === null || matchesFilter(c.hex, activeFilter))
              .map((color) => (
              <div
                key={color.name}
                className="p-3 cursor-pointer transition-opacity hover:opacity-80"
                style={{ backgroundColor: color.hex }}
                onClick={() => handleCopyColor(color.hex)}
              >
                <div className="text-sm font-medium" style={{ color: getContrastText(color.hex) }}>
                  {color.name}
                </div>
                <div className="text-xs font-mono" style={{ color: getContrastText(color.hex) }}>
                  {color.hex}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getContrastText(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#333333' : '#ffffff';
}
