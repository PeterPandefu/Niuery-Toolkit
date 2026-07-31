/**
 * Web Worker 工具类
 * 用于将耗时的编解码/格式化操作移到 Worker 线程，避免阻塞 UI
 * 规格要求：大文本处理时 UI 不阻塞
 */

interface PendingTask<TOutput> {
  resolve: (value: TOutput) => void;
  reject: (reason: unknown) => void;
}

let taskIdCounter = 0;
const pendingTasks = new Map<number, PendingTask<unknown>>();

// 内联 Worker 代码（避免额外文件加载）
const workerBlob = new Blob(
  [
    `
    self.onmessage = async function(e) {
      const { id, type, payload } = e.data;
      try {
        let result;
        switch (type) {
          case 'json-format': {
            const { text, indent } = payload;
            const parsed = JSON.parse(text);
            result = JSON.stringify(parsed, null, indent);
            break;
          }
          case 'json-minify': {
            const { text } = payload;
            const parsed = JSON.parse(text);
            result = JSON.stringify(parsed);
            break;
          }
          case 'base64-encode': {
            const { text } = payload;
            const bytes = new TextEncoder().encode(text);
            let binary = '';
            bytes.forEach(b => binary += String.fromCharCode(b));
            result = btoa(binary);
            break;
          }
          case 'base64-decode': {
            const { text } = payload;
            const binary = atob(text);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            result = new TextDecoder().decode(bytes);
            break;
          }
          case 'sort-lines': {
            const { text, descending, removeDuplicates } = payload;
            let lines = text.split('\\n');
            if (removeDuplicates) lines = [...new Set(lines)];
            lines.sort((a, b) => descending ? b.localeCompare(a) : a.localeCompare(b));
            result = lines.join('\\n');
            break;
          }
          default:
            throw new Error('Unknown task type: ' + type);
        }
        self.postMessage({ id, result });
      } catch (err) {
        self.postMessage({ id, error: err.message || String(err) });
      }
    };
  `,
  ],
  { type: 'application/javascript' }
);

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(URL.createObjectURL(workerBlob));
    worker.onmessage = (e: MessageEvent) => {
      const { id, result, error } = e.data;
      const task = pendingTasks.get(id);
      if (task) {
        pendingTasks.delete(id);
        if (error) {
          task.reject(new Error(error));
        } else {
          task.resolve(result);
        }
      }
    };
  }
  return worker;
}

/**
 * 在 Worker 中执行任务
 * @param type 任务类型
 * @param payload 任务参数
 * @returns Promise<TOutput>
 */
export function runInWorker<TOutput = string>(
  type: string,
  payload: Record<string, unknown>
): Promise<TOutput> {
  return new Promise((resolve, reject) => {
    const id = ++taskIdCounter;
    pendingTasks.set(id, { resolve: resolve as (value: unknown) => void, reject });
    getWorker().postMessage({ id, type, payload });
  });
}

/**
 * 判断文本是否为大文本（>100KB 建议使用 Worker）
 */
export function isLargeText(text: string): boolean {
  return text.length > 100_000;
}

/**
 * 智能执行：小文本在主线程，大文本在 Worker
 */
export async function smartProcess<TOutput = string>(
  text: string,
  mainThreadFn: () => TOutput,
  workerType: string,
  workerPayload: Record<string, unknown>
): Promise<TOutput> {
  if (isLargeText(text)) {
    return runInWorker<TOutput>(workerType, workerPayload);
  }
  return mainThreadFn();
}
