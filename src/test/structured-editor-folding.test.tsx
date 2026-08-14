import { useEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import JsonYamlConverter from '@/tools/converter/json-yaml';
import XmlJsonConverter from '@/tools/converter/xml-json';
import JsonFormatter from '@/tools/formatter/json-formatter';
import XmlFormatter from '@/tools/formatter/xml-formatter';
import { hasFoldableStructure } from '@/lib/structured-editor-folding';

const mockRunAction = vi.hoisted(() => vi.fn());

vi.mock('@monaco-editor/react', () => ({
  default: function MockEditor({ language, onMount, readOnly, value }: {
    language: string;
    onMount?: (editor: { getAction: () => { run: typeof mockRunAction } }) => void;
    readOnly?: boolean;
    value: string;
  }) {
    useEffect(() => {
      onMount?.({ getAction: () => ({ run: mockRunAction }) });
    }, [onMount]);
    return <div data-testid="结构化编辑器" data-language={language} data-readonly={readOnly}>{value}</div>;
  },
}));

vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ monacoTheme: 'test-theme' }) }));
vi.mock('@/hooks/use-tool-logger', () => ({ useToolLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));

describe('结构化编辑器折叠', () => {
  it('仅为具有嵌套结构的多行内容启用批量折叠', () => {
    expect(hasFoldableStructure('{\n  "nested": {}\n}', 'json')).toBe(true);
    expect(hasFoldableStructure('{"nested": {}}', 'json')).toBe(false);
    expect(hasFoldableStructure('root:\n  child: value', 'yaml')).toBe(true);
    expect(hasFoldableStructure('name: value', 'yaml')).toBe(false);
    expect(hasFoldableStructure('<root>\n  <child />\n</root>', 'xml')).toBe(true);
    expect(hasFoldableStructure('<root />', 'xml')).toBe(false);
  });

  it.each([
    ['JSON ↔ YAML', JsonYamlConverter, ['json', 'yaml']],
    ['XML ↔ JSON', XmlJsonConverter, ['xml', 'json']],
    ['JSON 格式化', JsonFormatter, ['json', 'json']],
    ['XML 格式化', XmlFormatter, ['xml', 'xml']],
  ])('%s 的输入和输出都会使用可折叠编辑器', (_name, Tool, languages) => {
    render(<Tool />);

    expect(screen.getByRole('button', { name: '全部折叠' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '全部展开' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '示例' }));

    expect(screen.getAllByTestId('结构化编辑器')).toHaveLength(2);
    expect(screen.getAllByTestId('结构化编辑器').map((element) => element.dataset.language)).toEqual(languages);
    expect(screen.getByRole('button', { name: '全部折叠' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '全部展开' })).toBeEnabled();
  });

  it('批量折叠和展开会同时调用两个编辑器的原生操作', () => {
    render(<JsonYamlConverter />);
    fireEvent.click(screen.getByRole('button', { name: '示例' }));
    mockRunAction.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '全部折叠' }));
    fireEvent.click(screen.getByRole('button', { name: '全部展开' }));

    expect(mockRunAction).toHaveBeenCalledTimes(4);
  });
});
