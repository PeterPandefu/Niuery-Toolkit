import { createWorker, OEM } from 'tesseract.js';
import { OCR_RECOGNITION_PARAMETERS } from './ocr-preprocess';

export type OcrLanguage = 'chi_sim' | 'eng' | 'chi_sim+eng';
export type OcrWorker = Pick<Tesseract.Worker, 'recognize' | 'setParameters' | 'terminate'>;

export const OCR_INITIALIZATION_TIMEOUT_MS = 45_000;

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
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      reject(new OcrInitializationTimeoutError());
    }, timeoutMs);

    Promise.resolve()
      .then(() =>
        createWorker(language, OEM.LSTM_ONLY, {
          workerPath: getOcrAssetUrl('worker.min.js'),
          workerBlobURL: false,
          corePath: getOcrAssetUrl('core/tesseract-core-lstm.wasm.js'),
          langPath: getOcrAssetUrl('lang'),
          gzip: true,
          logger: ({ status, progress }) => onProgress(status, progress),
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
            reject(error);
            return;
          }

          if (settled) {
            terminateSilently(worker);
            return;
          }
          settled = true;
          window.clearTimeout(timer);
          resolve(worker);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          reject(error);
        }
      );
  });
}
