import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslateStore } from '@/store/translate-store';
import { Eye, EyeOff, Languages, PawPrint, X } from 'lucide-react';
import { toast } from 'sonner';

interface TranslateSettingsDialogProps {
  onClose: () => void;
}

/** 翻译服务设置对话框（仿参考图：左侧密钥配置 + 右侧选项说明） */
export function TranslateSettingsDialog({ onClose }: TranslateSettingsDialogProps) {
  const { baiduAppId, baiduSecret, setBaiduCredentials, resetTranslateData } = useTranslateStore();
  const [appId, setAppId] = useState(baiduAppId);
  const [secret, setSecret] = useState(baiduSecret);
  const [showSecret, setShowSecret] = useState(false);

  const handleConfirm = () => {
    setBaiduCredentials(appId.trim(), secret.trim());
    toast.success('设置已保存');
    onClose();
  };

  const handleReset = () => {
    resetTranslateData();
    setAppId('');
    setSecret('');
    toast.success('已重置插件数据');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-[720px] max-w-full flex-col rounded-lg border border-border bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Languages className="h-4 w-4 text-primary" />
          <h2 className="flex-1 text-sm font-semibold">设置</h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* 主体 */}
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[1fr_240px]">
          {/* 左：翻译服务数据 */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <span className="h-[3px] w-[3px] rounded-full bg-primary/70" />
              翻译服务数据
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <PawPrint className="h-4 w-4 text-primary" />
                百度翻译
              </div>
              <div className="grid gap-3 sm:grid-cols-[110px_1fr] sm:items-center">
                <Label className="text-right text-xs text-muted-foreground">APP ID</Label>
                <Input
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="请输入百度翻译 APP ID"
                  className="h-8 text-xs"
                />
                <Label className="text-right text-xs text-muted-foreground">密钥</Label>
                <div className="relative">
                  <Input
                    type={showSecret ? 'text' : 'password'}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    placeholder="请输入百度翻译密钥"
                    className="h-8 pr-8 text-xs"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowSecret(!showSecret)}
                    title={showSecret ? '隐藏密钥' : '显示密钥'}
                  >
                    {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* 右：选项说明 */}
          <div className="rounded-lg bg-muted/50 p-4">
            <div className="mb-3 text-xs font-semibold text-primary">🔖 选项说明</div>
            <h3 className="mb-2 text-sm font-semibold">翻译服务数据:</h3>
            <p className="text-xs leading-5 text-muted-foreground">
              你所申请翻译服务相关的数据，应该填写在此处对应的地方。密钥仅保存在本机，不会上传。
            </p>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleReset}
          >
            重置插件数据
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button size="sm" onClick={handleConfirm}>
              确定
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
