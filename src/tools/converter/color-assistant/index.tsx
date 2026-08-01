import { useState, useCallback } from 'react';
import { LayoutGrid, Grid3X3, ImageIcon, PenTool, Palette, Star } from 'lucide-react';
import { toast } from 'sonner';
import ColorWheelTab from './ColorWheelTab';
import UiPaletteTab from './UiPaletteTab';
import ImageColorTab from './ImageColorTab';
import TraditionalColorTab from './TraditionalColorTab';
import GradientTab from './GradientTab';
import FavoriteColorsTab from './FavoriteColorsTab';

type TabId = 'color' | 'ui-palette' | 'image-color' | 'traditional' | 'gradient' | 'favorites';

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'color', label: '颜色', icon: LayoutGrid },
  { id: 'ui-palette', label: 'UI 色卡', icon: Grid3X3 },
  { id: 'image-color', label: '图片色卡', icon: ImageIcon },
  { id: 'traditional', label: '传统色', icon: PenTool },
  { id: 'gradient', label: '渐变色', icon: Palette },
  { id: 'favorites', label: '收藏颜色', icon: Star },
];

const FAVORITES_KEY = 'color-assistant-favorites';

function loadFavorites(): string[] {
  try {
    const stored = localStorage.getItem(FAVORITES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: string[]) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
}

export default function ColorAssistant() {
  const [activeTab, setActiveTab] = useState<TabId>('color');
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  const [removeHash, setRemoveHash] = useState(false);

  const handleAddFavorite = useCallback((hex: string) => {
    setFavorites(prev => {
      if (prev.includes(hex)) {
        toast.info('该颜色已收藏');
        return prev;
      }
      const next = [...prev, hex];
      saveFavorites(next);
      toast.success('已收藏');
      return next;
    });
  }, []);

  const handleRemoveFavorite = useCallback((hex: string) => {
    setFavorites(prev => {
      const next = prev.filter(c => c !== hex);
      saveFavorites(next);
      return next;
    });
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'color':
        return <ColorWheelTab onAddFavorite={handleAddFavorite} removeHash={removeHash} />;
      case 'ui-palette':
        return <UiPaletteTab />;
      case 'image-color':
        return <ImageColorTab />;
      case 'traditional':
        return <TraditionalColorTab />;
      case 'gradient':
        return <GradientTab />;
      case 'favorites':
        return <FavoriteColorsTab favorites={favorites} onRemove={handleRemoveFavorite} />;
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left Sidebar */}
      <div className="flex w-[140px] flex-col border-r bg-muted/30 py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2.5 px-4 py-2.5 text-left text-sm transition-colors ${
                isActive
                  ? 'bg-background text-foreground font-medium shadow-sm border-r-2 border-primary'
                  : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span>{tab.label}</span>
            </button>
          );
        })}
        {/* Bottom: remove hash option */}
        <div className="mt-auto px-4 py-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="rounded"
              checked={removeHash}
              onChange={(e) => setRemoveHash(e.target.checked)}
            />
            色值去 &quot;#&quot;
          </label>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}
