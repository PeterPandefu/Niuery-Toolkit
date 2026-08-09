import type { OcrLanguage } from './ocr-engine';

const CHINESE_CONTEXT_CORRECTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/白分之/g, '百分之'],
  [/识别测记/g, '识别测试'],
];

export function postprocessOcrText(text: string, language: OcrLanguage) {
  if (language === 'eng') return text;

  return CHINESE_CONTEXT_CORRECTIONS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text
  );
}
