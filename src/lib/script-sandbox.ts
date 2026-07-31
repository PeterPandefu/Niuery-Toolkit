import type { ScriptLog } from '@/store/api-tester-store';

export interface ScriptContext {
  request?: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
  };
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    time: number;
  };
}

export interface ScriptResult {
  logs: ScriptLog[];
  request?: ScriptContext['request'];
  variables: Record<string, string>;
  error?: string;
}

const WORKER_CODE = `
self.onmessage = function(e) {
  const { script, context } = e.data;
  const logs = [];
  const variables = {};
  let request = context.request ? { ...context.request, headers: { ...context.request.headers } } : undefined;

  const assert = (condition, message) => {
    if (condition) {
      logs.push({ type: 'assert-pass', message });
    } else {
      logs.push({ type: 'assert-fail', message });
    }
  };

  const setVariable = (key, value) => {
    variables[key] = String(value);
    logs.push({ type: 'info', message: 'Set variable: ' + key + ' = ' + value });
  };

  const console = {
    log: (...args) => {
      logs.push({ type: 'info', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') });
    },
    error: (...args) => {
      logs.push({ type: 'error', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') });
    }
  };

  try {
    const fn = new Function('request', 'response', 'assert', 'setVariable', 'console', script);
    fn(request, context.response, assert, setVariable, console);
    self.postMessage({ logs, request, variables });
  } catch (err) {
    logs.push({ type: 'error', message: err.message });
    self.postMessage({ logs, request, variables, error: err.message });
  }
};
`;

/**
 * 在 Web Worker 沙箱中执行脚本
 * 超时 5 秒自动终止
 */
export function executeScript(script: string, context: ScriptContext): Promise<ScriptResult> {
  return new Promise((resolve) => {
    if (!script.trim()) {
      resolve({ logs: [], variables: {} });
      return;
    }

    const blob = new Blob([WORKER_CODE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);

    const timeout = setTimeout(() => {
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({
        logs: [{ type: 'error', message: '脚本执行超时 (5s)' }],
        variables: {},
        error: 'timeout',
      });
    }, 5000);

    worker.onmessage = (e) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(e.data as ScriptResult);
    };

    worker.onerror = (err) => {
      clearTimeout(timeout);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve({
        logs: [{ type: 'error', message: err.message }],
        variables: {},
        error: err.message,
      });
    };

    worker.postMessage({ script, context });
  });
}
