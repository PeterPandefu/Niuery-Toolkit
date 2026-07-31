import { useState, useMemo } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import dayjs from 'dayjs';
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { parseJwt } from '@/lib/codec-utils';

export default function JwtDecoder() {
  const [token, setToken] = useState('');

  const result = useMemo(() => {
    if (!token.trim()) return null;
    return parseJwt(token);
  }, [token]);

  const expiration = useMemo(() => {
    if (!result || 'error' in result) return null;
    const exp = result.payload.exp as number | undefined;
    if (!exp) return null;
    const expDate = dayjs(exp * 1000);
    const isExpired = expDate.isBefore(dayjs());
    return { date: expDate.format('YYYY-MM-DD HH:mm:ss'), isExpired };
  }, [result]);

  const issuedAt = useMemo(() => {
    if (!result || 'error' in result) return null;
    const iat = result.payload.iat as number | undefined;
    if (!iat) return null;
    return dayjs(iat * 1000).format('YYYY-MM-DD HH:mm:ss');
  }, [result]);

  const sampleJwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE4OTM0NTYwMDB9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        {/* Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>JWT Token</Label>
            <button
              onClick={() => setToken(sampleJwt)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              使用示例
            </button>
          </div>
          <Textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="粘贴 JWT Token..."
            className="min-h-[100px] resize-none font-mono text-sm"
            spellCheck={false}
          />
        </div>

        {/* Error */}
        {result && 'error' in result && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{result.error}</p>
          </div>
        )}

        {/* Decoded Parts */}
        {result && !('error' in result) && (
          <div className="grid gap-6">
            {/* Header */}
            <div className="rounded-lg border">
              <div className="border-b bg-red-500/10 px-4 py-2">
                <span className="text-sm font-medium text-red-600 dark:text-red-400">
                  HEADER
                </span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-sm">
                {JSON.stringify(result.header, null, 2)}
              </pre>
            </div>

            {/* Payload */}
            <div className="rounded-lg border">
              <div className="border-b bg-purple-500/10 px-4 py-2">
                <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                  PAYLOAD
                </span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-sm">
                {JSON.stringify(result.payload, null, 2)}
              </pre>
            </div>

            {/* Signature */}
            <div className="rounded-lg border">
              <div className="border-b bg-blue-500/10 px-4 py-2">
                <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                  SIGNATURE
                </span>
              </div>
              <pre className="overflow-x-auto p-4 font-mono text-sm break-all">
                {result.signature}
              </pre>
            </div>

            {/* Time Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              {issuedAt && (
                <div className="flex items-center gap-3 rounded-lg border p-4">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="text-sm text-muted-foreground">签发时间 (iat)</div>
                    <div className="font-mono">{issuedAt}</div>
                  </div>
                </div>
              )}
              {expiration && (
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-4',
                    expiration.isExpired && 'border-destructive/50 bg-destructive/10'
                  )}
                >
                  {expiration.isExpired ? (
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  )}
                  <div>
                    <div className="text-sm text-muted-foreground">过期时间 (exp)</div>
                    <div className="font-mono">
                      {expiration.date}
                      {expiration.isExpired && (
                        <span className="ml-2 text-destructive">已过期</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              ⚠️ 注意：此工具仅在本地解析 JWT，不会验证签名，也不会发送任何数据到服务器。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
