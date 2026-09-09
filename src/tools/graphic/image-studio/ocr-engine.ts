import { createWorker, OEM } from 'tesseract.js';
import { createLogger } from '@/lib/logger';
import { OCR_RECOGNITION_PARAMETERS } from './ocr-preprocess';

export type OcrLanguage = 'chi_sim' | 'eng' | 'chi_sim+eng';
export type OcrWorker = Pick<Tesseract.Worker, 'recognize' | 'setParameters' | 'terminate'>;

export const OCR_INITIALIZATION_TIMEOUT_MS = 45_000;

const log = createLogger('ocr-engine');

export class OcrInitializationTimeoutError extends Error {
  constructor() {
    super('OCR 引擎初始化超时');
    this.name = 'OcrInitializationTimeoutError';
  }
}

function getOcrAssetUrl(path: string) {
  return new URL(`ocr/${path}`, window.location.href).href;
}

function terminateSilently(worker: OcrWorker) {
  void Promise.resolve(worker.terminate()).catch(() => undefined);
}

export function createOcrWorker(
  language: OcrLanguage,
  onProgress: (status: string, progress: number) => void,
  timeoutMs = OCR_INITIALIZATION_TIMEOUT_MS
): Promise<OcrWorker> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const assets = {
      workerPath: getOcrAssetUrl('worker.min.js'),
      corePath: getOcrAssetUrl('core/tesseract-core-lstm.wasm.js'),
      langPath: getOcrAssetUrl('lang'),
    };
    let lastStatus = '准备初始化';
    log.info('OCR 初始化开始', { language, timeoutMs, assets });
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      const error = new OcrInitializationTimeoutError();
      log.error('OCR 初始化超时', {
        language,
        timeoutMs,
        elapsedMs: Date.now() - startedAt,
        lastStatus,
        assets,
      });
      reject(error);
    }, timeoutMs);

    Promise.resolve()
      .then(() =>
        createWorker(language, OEM.LSTM_ONLY, {
          workerPath: getOcrAssetUrl('worker.min.js'),
          workerBlobURL: false,
          corePath: getOcrAssetUrl('core/tesseract-core-lstm.wasm.js'),
          langPath: getOcrAssetUrl('lang'),
          gzip: true,
          logger: ({ status, progress }) => {
            lastStatus = status;
            onProgress(status, progress);
          },
        })
      )
      .then(
        async (worker) => {
          if (settled) {
            terminateSilently(worker);
            return;
          }

          try {
            await worker.setParameters(OCR_RECOGNITION_PARAMETERS);
          } catch (error) {
            if (settled) {
              terminateSilently(worker);
              return;
            }
            settled = true;
            window.clearTimeout(timer);
            await worker.terminate().catch(() => undefined);
            log.error('OCR 参数初始化失败', {
              language,
              elapsedMs: Date.now() - startedAt,
              lastStatus,
              error,
            });
            reject(error);
            return;
          }

          if (settled) {
            terminateSilently(worker);
            return;
          }
          settled = true;
          window.clearTimeout(timer);
          log.info('OCR 初始化完成', {
            language,
            elapsedMs: Date.now() - startedAt,
            lastStatus,
          });
          resolve(worker);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          log.error('OCR 本地资源加载失败', {
            language,
            elapsedMs: Date.now() - startedAt,
            lastStatus,
            assets,
            error,
          });
          reject(error);
        }
      );
  });
}
