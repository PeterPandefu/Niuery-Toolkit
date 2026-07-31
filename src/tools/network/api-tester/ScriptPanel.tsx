import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';

interface ScriptPanelProps {
  preScript: string;
  postScript: string;
  onPreScriptChange: (script: string) => void;
  onPostScriptChange: (script: string) => void;
}

const PRE_SCRIPT_PLACEHOLDER = `// 前置脚本：在请求发送前执行
// 可访问 request 对象并修改
// request.url, request.method, request.headers, request.body

// 示例：添加自定义 Header
request.headers['X-Timestamp'] = Date.now().toString();

// 示例：设置变量
setVariable('token', 'abc123');
`;

const POST_SCRIPT_PLACEHOLDER = `// 后置脚本：在收到响应后执行
// 可访问 response 对象
// response.status, response.headers, response.body, response.time

// 示例：断言状态码
assert(response.status === 200, '状态码应为 200');

// 示例：解析响应并提取变量
const data = JSON.parse(response.body);
setVariable('userId', data.id);

// 示例：断言响应时间
assert(response.time < 1000, '响应时间应小于 1s');
`;

export function ScriptPanel({
  preScript,
  postScript,
  onPreScriptChange,
  onPostScriptChange,
}: ScriptPanelProps) {
  const [activeTab, setActiveTab] = useState<'pre' | 'post'>('pre');

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        <button
          onClick={() => setActiveTab('pre')}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'pre'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          )}
        >
          前置脚本
        </button>
        <button
          onClick={() => setActiveTab('post')}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            activeTab === 'post'
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          )}
        >
          后置脚本
        </button>
      </div>

      {activeTab === 'pre' ? (
        <Textarea
          value={preScript}
          onChange={(e) => onPreScriptChange(e.target.value)}
          placeholder={PRE_SCRIPT_PLACEHOLDER}
          className="min-h-[200px] resize-y font-mono text-xs leading-relaxed"
          spellCheck={false}
        />
      ) : (
        <Textarea
          value={postScript}
          onChange={(e) => onPostScriptChange(e.target.value)}
          placeholder={POST_SCRIPT_PLACEHOLDER}
          className="min-h-[200px] resize-y font-mono text-xs leading-relaxed"
          spellCheck={false}
        />
      )}

      <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
        <p className="font-medium">可用 API：</p>
        <ul className="mt-1 space-y-0.5">
          <li><code className="text-primary">assert(condition, message)</code> - 断言</li>
          <li><code className="text-primary">setVariable(key, value)</code> - 设置环境变量</li>
          <li><code className="text-primary">console.log(...)</code> - 输出日志</li>
          {activeTab === 'pre' ? (
            <li><code className="text-primary">request</code> - 请求对象 (url/method/headers/body)</li>
          ) : (
            <li><code className="text-primary">response</code> - 响应对象 (status/headers/body/time)</li>
          )}
        </ul>
      </div>
    </div>
  );
}
