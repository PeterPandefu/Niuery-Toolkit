import { describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (path: string, protocol = 'asset') => `http://${protocol}.localhost/${encodeURIComponent(path)}` }));

describe('feature resource dependencies', () => {
  it('does not require export engines for normal Markdown editing', async () => {
    const { resourcesForFeature } = await import('@/lib/resources');
    expect(resourcesForFeature('markdown-edit')).toEqual([]);
    expect(resourcesForFeature('html-export')).toEqual(['chromium']);
    expect(resourcesForFeature('plantuml')).toEqual(['java', 'plantuml']);
  });
  it('only requests OCR language packs selected by the user', async () => {
    const { resourcesForOcr } = await import('@/lib/resources');
    expect(resourcesForOcr('eng')).toEqual(['ocr-engine', 'ocr-eng']);
    expect(resourcesForOcr('chi_sim')).toEqual(['ocr-engine', 'ocr-chi-sim']);
    expect(resourcesForOcr('chi_sim+eng')).toEqual(['ocr-engine', 'ocr-chi-sim', 'ocr-eng']);
  });
});

it('loads desktop OCR through catalog-only URLs without duplicating language models', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
  invoke.mockResolvedValue({ 'ocr-engine': 'C:/resources/worker.min.js', 'ocr-eng': 'C:/resources/eng.traineddata.gz' });
  try {
    const { ocrAssetUrls } = await import('@/lib/resources');
    const urls = await ocrAssetUrls('eng');
    expect(urls).toEqual({ workerPath: 'http://resource.localhost/ocr-engine/worker.min.js', corePath: 'http://resource.localhost/ocr-engine/core/tesseract-core-lstm.wasm.js', langPath: 'http://resource.localhost/lang' });
    expect(invoke.mock.calls.some(([command]) => command === 'get_ocr_language_directory')).toBe(false);
  } finally { Reflect.deleteProperty(window, '__TAURI_INTERNALS__'); }
});
