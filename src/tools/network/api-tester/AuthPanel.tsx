import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import type { AuthConfig, AuthType } from '@/store/api-tester-store';

interface AuthPanelProps {
  auth: AuthConfig;
  onChange: (auth: AuthConfig) => void;
}

const AUTH_TYPES: { value: AuthType; label: string }[] = [
  { value: 'none', label: '无认证' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'apikey', label: 'API Key' },
];

export function AuthPanel({ auth, onChange }: AuthPanelProps) {
  return (
    <div className="space-y-4">
      {/* Auth Type Selector */}
      <div className="flex flex-wrap gap-1">
        {AUTH_TYPES.map((at) => (
          <button
            key={at.value}
            onClick={() => onChange({ ...auth, type: at.value })}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              auth.type === at.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {at.label}
          </button>
        ))}
      </div>

      {/* Auth Config */}
      {auth.type === 'none' && (
        <p className="py-2 text-sm text-muted-foreground">该请求不使用认证</p>
      )}

      {auth.type === 'bearer' && (
        <div className="space-y-2">
          <Label className="text-xs">Token</Label>
          <Input
            value={auth.bearerToken}
            onChange={(e) => onChange({ ...auth, bearerToken: e.target.value })}
            placeholder="输入 Bearer Token，支持 {{variable}}"
            className="font-mono text-sm"
          />
        </div>
      )}

      {auth.type === 'basic' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs">用户名</Label>
            <Input
              value={auth.basicUsername}
              onChange={(e) => onChange({ ...auth, basicUsername: e.target.value })}
              placeholder="username"
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">密码</Label>
            <Input
              type="password"
              value={auth.basicPassword}
              onChange={(e) => onChange({ ...auth, basicPassword: e.target.value })}
              placeholder="password"
              className="font-mono text-sm"
            />
          </div>
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs">Key 名称</Label>
              <Input
                value={auth.apiKeyName}
                onChange={(e) => onChange({ ...auth, apiKeyName: e.target.value })}
                placeholder="X-API-Key"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Key 值</Label>
              <Input
                value={auth.apiKeyValue}
                onChange={(e) => onChange({ ...auth, apiKeyValue: e.target.value })}
                placeholder="your-api-key"
                className="font-mono text-sm"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">添加位置</Label>
            <div className="flex gap-2">
              <button
                onClick={() => onChange({ ...auth, apiKeyIn: 'header' })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  auth.apiKeyIn === 'header'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                Header
              </button>
              <button
                onClick={() => onChange({ ...auth, apiKeyIn: 'query' })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  auth.apiKeyIn === 'query'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                Query Params
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
