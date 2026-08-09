import { describe, expect, it } from 'vitest';
import { postprocessOcrText } from '@/tools/graphic/image-studio/ocr-postprocess';

describe('OCR 文本后处理', () => {
  it('仅在中文上下文中修正已确认的语义错误', () => {
    expect(postprocessOcrText('识别测记\n白分之九十五', 'chi_sim')).toBe('识别测试\n百分之九十五');
    expect(postprocessOcrText('识别测记\n白分之九十五', 'chi_sim+eng')).toBe('识别测试\n百分之九十五');
  });

  it('不修改英文结果或未命中的内容', () => {
    expect(postprocessOcrText('white percentage', 'eng')).toBe('white percentage');
    expect(postprocessOcrText('白色分区', 'chi_sim')).toBe('白色分区');
  });
});
