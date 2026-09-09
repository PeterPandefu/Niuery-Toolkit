import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramEditor, type DiagramRenderer } from '@/tools/diagram/diagram-editor';

vi.mock('@monaco-editor/react', () => ({
  loader: { config: vi.fn() },
  default: function MockEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Diagram source" value={value} onChange={(event) => onChange(event.target.value)} />;
  },
}));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ monacoTheme: 'test-theme', scheme: 'dark' }),
}));

const openTextDocument = vi.hoisted(() => vi.fn());

vi.mock('@/lib/local-documents', () => ({ openTextDocument }));

const renderDiagram = vi.fn().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>preview</text></svg>' });
const renderer: DiagramRenderer = { render: renderDiagram };

describe('DiagramEditor', () => {
  beforeEach(() => {
    localStorage.clear();
    openTextDocument.mockReset();
    renderDiagram.mockReset();
    renderDiagram.mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>preview</text></svg>' });
  });

  it('provides a zoomable Mermaid editor with the follow-theme control enabled by default', async () => {
    render(<DiagramEditor kind="mermaid" renderer={renderer} />);

    expect(screen.getByRole('heading', { name: 'Mermaid 实时编辑器' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '跟随主题' })).toBeChecked();
    expect(screen.getByText('100%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '放大预览' }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '导出 SVG' })).toBeEnabled());
    expect(screen.getAllByText('实时预览')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '导出 PNG' })).toBeEnabled();
  });

  it.each(['mermaid', 'plantuml'] as const)('zooms the %s preview with a plain mouse wheel', async (kind) => {
    render(<DiagramEditor kind={kind} renderer={renderer} />);
    await waitFor(() => expect(screen.getByRole('img', { name: kind === 'mermaid' ? 'Mermaid 实时编辑器 预览' : 'PlantUML 实时编辑器 预览' })).toBeInTheDocument());

    fireEvent.wheel(screen.getByRole('region', { name: '图片预览区域' }), { deltaY: -100 });

    expect(screen.getByText('125%')).toBeInTheDocument();
  });

  it('restores the valid starter diagram when the user creates a new document', async () => {
    render(<DiagramEditor kind="plantuml" renderer={renderer} />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'PlantUML 实时编辑器 预览' })).toBeInTheDocument());
    const source = screen.getByRole('textbox', { name: 'Diagram source' });
    fireEvent.change(source, { target: { value: 'broken document' } });
    fireEvent.click(screen.getByRole('button', { name: '新建图表' }));

    expect((source as HTMLTextAreaElement).value).toContain('@startuml');
  });

  it('shows imported source for confirmation before replacing the draft', async () => {
    openTextDocument.mockResolvedValueOnce({ path: 'diagram.mmd', contents: 'flowchart TD\nA --> Imported' });
    render(<DiagramEditor kind="mermaid" renderer={renderer} />);

    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));
    expect(await screen.findByText('确认替换当前草稿')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === 'flowchart TD\nA --> Imported')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认替换' }));
    expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveValue('flowchart TD\nA --> Imported');
  });

  it('renders the current source immediately when the user selects refresh', async () => {
    render(<DiagramEditor kind="mermaid" renderer={renderer} />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Mermaid 实时编辑器 预览' })).toBeInTheDocument());
    renderDiagram.mockClear();

    await act(async () => {
      fireEvent.change(screen.getByRole('textbox', { name: 'Diagram source' }), { target: { value: 'flowchart LR\nNow --> Render' } });
      fireEvent.click(screen.getByRole('button', { name: '立即刷新' }));
      await Promise.resolve();
    });

    expect(renderDiagram).toHaveBeenCalledWith('flowchart LR\nNow --> Render', { scheme: 'dark' });
  });
});
