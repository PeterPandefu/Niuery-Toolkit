import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiagramEditor, type DiagramRenderer } from '@/tools/diagram/diagram-editor';
import { Toaster } from 'sonner';

vi.mock('@monaco-editor/react', () => ({
  loader: { config: vi.fn() },
  default: function MockEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return <textarea aria-label="Diagram source" value={value} onChange={(event) => onChange(event.target.value)} />;
  },
}));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ monacoTheme: 'test-theme', scheme: 'dark' }),
}));

const openTextDocuments = vi.hoisted(() => vi.fn());

vi.mock('@/lib/local-documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/local-documents')>()),
  openTextDocuments,
}));

function nativeSelection(...files: { path: string; contents: string }[]) {
  return { files, failures: [] };
}

const renderDiagram = vi.fn().mockResolvedValue({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>preview</text></svg>' });
const renderer: DiagramRenderer = { render: renderDiagram };

describe('DiagramEditor', () => {
  beforeEach(() => {
    localStorage.clear();
    openTextDocuments.mockReset();
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

  it.each(['mermaid', 'plantuml'] as const)('opens the %s full-screen preview above the tool and returns to the editor', async (kind) => {
    const { container } = render(<DiagramEditor kind={kind} renderer={renderer} />);
    const label = kind === 'mermaid' ? 'Mermaid 实时编辑器 预览' : 'PlantUML 实时编辑器 预览';
    await screen.findByRole('img', { name: label });
    fireEvent.click(screen.getByRole('button', { name: '全屏预览' }));
    const dialog = screen.getByRole('dialog', { name: '图片预览' });
    expect(dialog.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dialog);
    fireEvent.wheel(within(dialog).getByRole('region', { name: '图片预览区域' }), { deltaY: -100 });
    expect(within(dialog).getByText('125%')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '下一张（→）' })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出 SVG' })).toBeEnabled();
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
    openTextDocuments.mockResolvedValueOnce(nativeSelection({ path: 'diagram.mmd', contents: 'flowchart TD\nA --> Imported' }));
    render(<DiagramEditor kind="mermaid" renderer={renderer} />);

    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));
    expect(await screen.findByText('确认替换当前草稿')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === 'flowchart TD\nA --> Imported')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认替换' }));
    expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveValue('flowchart TD\nA --> Imported');
  });

  it('extracts a Mermaid block from Markdown and keeps the draft until confirmation', async () => {
    openTextDocuments.mockResolvedValueOnce(nativeSelection({
      path: 'notes.md',
      contents: '# Notes\n\n```mermaid\nflowchart TD\nA --> Extracted\n```\n\nOther text',
    }));
    render(<DiagramEditor kind="mermaid" renderer={renderer} />);
    const source = screen.getByRole('textbox', { name: 'Diagram source' });
    const original = (source as HTMLTextAreaElement).value;

    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));
    const preview = await screen.findByText((_, element) => element?.tagName === 'PRE' && element.textContent === 'flowchart TD\nA --> Extracted');
    expect(preview).toBeVisible();
    expect(source).toHaveValue(original);
    expect(openTextDocuments).toHaveBeenCalledWith('Mermaid 实时编辑器 源文件', ['mmd', 'mermaid', 'txt', 'md', 'markdown']);

    fireEvent.click(screen.getByRole('button', { name: '确认替换' }));
    expect(source).toHaveValue('flowchart TD\nA --> Extracted');
  });

  it('lets the user preview and import the second Mermaid block without merging diagrams', async () => {
    openTextDocuments.mockResolvedValueOnce(nativeSelection({
      path: 'diagrams.markdown',
      contents: '```mermaid\nflowchart LR\nA --> First\n```\n\n```mermaid\nsequenceDiagram\nAlice->>Bob: Second\n```',
    }));
    render(<DiagramEditor kind="mermaid" renderer={renderer} />);
    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));
    const selector = await screen.findByRole('combobox', { name: '选择 Mermaid 代码块' });
    fireEvent.click(selector);
    const list = screen.getByRole('listbox', { name: '选择 Mermaid 代码块' });
    expect(within(list).getAllByRole('option')).toHaveLength(2);
    fireEvent.click(within(list).getAllByRole('option')[1]);
    expect(screen.getByText((_, element) => element?.tagName === 'PRE' && element.textContent === 'sequenceDiagram\nAlice->>Bob: Second')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: '确认替换' }));
    expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveValue('sequenceDiagram\nAlice->>Bob: Second');
  });

  it('keeps the current draft when the user cancels an extracted import', async () => {
    openTextDocuments.mockResolvedValueOnce(nativeSelection({ path: 'notes.txt', contents: '```mermaid\nflowchart LR\nA --> Cancelled\n```' }));
    render(<DiagramEditor kind="mermaid" renderer={renderer} />);
    const source = screen.getByRole('textbox', { name: 'Diagram source' });
    fireEvent.change(source, { target: { value: 'flowchart TD\nKeep --> Draft' } });
    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));
    await screen.findByText('确认替换当前草稿');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(source).toHaveValue('flowchart TD\nKeep --> Draft');
    expect(screen.queryByText('确认替换当前草稿')).not.toBeInTheDocument();
  });

  it('rejects unrelated text without offering to replace the draft', async () => {
    openTextDocuments.mockResolvedValueOnce(nativeSelection({ path: 'notes.md', contents: '# Notes\n\nNo diagrams here.' }));
    render(<><Toaster /><DiagramEditor kind="mermaid" renderer={renderer} /></>);
    const source = screen.getByRole('textbox', { name: 'Diagram source' });
    const original = (source as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));
    expect(await screen.findByText(/未找到 Mermaid 代码块，也无法识别为有效的 Mermaid 源码/)).toBeVisible();
    expect(screen.queryByText('确认替换当前草稿')).not.toBeInTheDocument();
    expect(source).toHaveValue(original);
  });

  it('extracts Mermaid from browser file input using the same confirmation flow', async () => {
    const { container } = render(<DiagramEditor kind="mermaid" renderer={renderer} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['unused'], 'browser.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => 'Text\n\n~~~mermaid\nflowchart LR\nBrowser --> Imported\n~~~' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByText((_, element) => element?.tagName === 'PRE' && element.textContent === 'flowchart LR\nBrowser --> Imported')).toBeVisible();
    expect(input.accept).toBe('.mmd,.mermaid,.txt,.md,.markdown');
    fireEvent.click(screen.getByRole('button', { name: '确认替换' }));
    expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveValue('flowchart LR\nBrowser --> Imported');
  });

  it('reports native file read failures and keeps the draft', async () => {
    openTextDocuments.mockRejectedValueOnce(new Error('无法读取文档'));
    render(<><Toaster /><DiagramEditor kind="mermaid" renderer={renderer} /></>);
    const source = screen.getByRole('textbox', { name: 'Diagram source' });
    const original = (source as HTMLTextAreaElement).value;
    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));
    expect(await screen.findByText('导入失败：无法读取文档')).toBeVisible();
    expect(screen.queryByText('确认替换当前草稿')).not.toBeInTheDocument();
    expect(source).toHaveValue(original);
  });

  it('reports browser file read failures and enables another import', async () => {
    const { container } = render(<><Toaster /><DiagramEditor kind="mermaid" renderer={renderer} /></>);
    const source = screen.getByRole('textbox', { name: 'Diagram source' });
    const original = (source as HTMLTextAreaElement).value;
    const file = new File([], 'unreadable.md');
    Object.defineProperty(file, 'text', { value: async () => { throw new Error('文件已被移动'); } });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
    expect(await screen.findByText('导入失败：文件已被移动')).toBeVisible();
    expect(screen.getByRole('button', { name: '导入源文件' })).toBeEnabled();
    expect(source).toHaveValue(original);
  });

  it('preserves PlantUML source import and its file filter', async () => {
    openTextDocuments.mockResolvedValueOnce(nativeSelection({ path: 'diagram.puml', contents: '@startuml\nAlice -> Bob: Hi\n@enduml' }));
    render(<DiagramEditor kind="plantuml" renderer={renderer} />);
    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));
    await screen.findByText('确认替换当前草稿');
    expect(openTextDocuments).toHaveBeenCalledWith('PlantUML 实时编辑器 源文件', ['puml']);
    fireEvent.click(screen.getByRole('button', { name: '确认替换' }));
    expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveValue('@startuml\nAlice -> Bob: Hi\n@enduml');
  });

  it('imports every selected Mermaid file as its own tab without a confirmation dialog', async () => {
    openTextDocuments.mockResolvedValueOnce(nativeSelection(
      { path: 'C:\\docs\\first.mmd', contents: 'flowchart TD\nA --> First' },
      { path: '/docs/second.md', contents: '# Notes\n\n```mermaid\nflowchart LR\nB --> Second\n```' },
    ));
    render(<><Toaster /><DiagramEditor kind="mermaid" renderer={renderer} /></>);

    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));

    expect(await screen.findByRole('tab', { name: 'first.mmd' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'second.md' })).toBeInTheDocument();
    expect(screen.queryByText('确认替换当前草稿')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveValue('flowchart LR\nB --> Second');
    expect(await screen.findByText('已导入 2 个页签')).toBeVisible();
  });

  it('creates one tab per Mermaid block when a batch includes a multi-diagram Markdown file', async () => {
    openTextDocuments.mockResolvedValueOnce(nativeSelection(
      { path: 'single.mmd', contents: 'flowchart TD\nA --> Only' },
      { path: 'multi.md', contents: '```mermaid\nflowchart LR\nA --> One\n```\n\n```mermaid\nsequenceDiagram\nAlice->>Bob: Two\n```' },
    ));
    render(<DiagramEditor kind="mermaid" renderer={renderer} />);

    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));

    expect(await screen.findByRole('tab', { name: 'multi.md · 图表 2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'multi.md · 图表 1' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'single.mmd' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveValue('sequenceDiagram\nAlice->>Bob: Two');
  });

  it('imports readable files and reports the ones the native dialog could not read', async () => {
    openTextDocuments.mockResolvedValueOnce({
      files: [{ path: 'good.puml', contents: '@startuml\nA -> B\n@enduml' }],
      failures: [{ path: 'C:\\docs\\bad.puml', error: '读取文档失败: 拒绝访问' }],
    });
    render(<><Toaster /><DiagramEditor kind="plantuml" renderer={renderer} /></>);

    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));

    expect(await screen.findByRole('tab', { name: 'good.puml' })).toBeInTheDocument();
    expect(await screen.findByText('导入失败：bad.puml：读取文档失败: 拒绝访问')).toBeVisible();
    expect(screen.queryByText('确认替换当前草稿')).not.toBeInTheDocument();
  });

  it('skips Markdown without diagrams and still imports the other selected files', async () => {
    openTextDocuments.mockResolvedValueOnce(nativeSelection(
      { path: 'plain.md', contents: '# Notes\n\nNo diagrams here.' },
      { path: 'valid.mmd', contents: 'flowchart TD\nA --> Valid' },
    ));
    render(<><Toaster /><DiagramEditor kind="mermaid" renderer={renderer} /></>);

    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));

    expect(await screen.findByRole('tab', { name: 'valid.mmd' })).toBeInTheDocument();
    expect(await screen.findByText(/导入失败：plain\.md：未找到 Mermaid 代码块/)).toBeVisible();
    expect(screen.queryByRole('tab', { name: 'plain.md' })).not.toBeInTheDocument();
  });

  it('does nothing when the multi-select dialog is cancelled', async () => {
    openTextDocuments.mockResolvedValueOnce({ files: [], failures: [] });
    render(<><Toaster /><DiagramEditor kind="mermaid" renderer={renderer} /></>);

    fireEvent.click(screen.getByRole('button', { name: '导入源文件' }));

    await waitFor(() => expect(openTextDocuments).toHaveBeenCalled());
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.queryByText('确认替换当前草稿')).not.toBeInTheDocument();
    expect(screen.queryByText(/已导入/)).not.toBeInTheDocument();
  });

  it('imports multiple browser-selected files as tabs and keeps the input multi-selectable', async () => {
    const { container } = render(<><Toaster /><DiagramEditor kind="plantuml" renderer={renderer} /></>);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);
    const first = new File(['unused'], 'first.puml');
    Object.defineProperty(first, 'text', { value: async () => '@startuml\nA -> B\n@enduml' });
    const second = new File(['unused'], 'second.puml');
    Object.defineProperty(second, 'text', { value: async () => '@startuml\nC -> D\n@enduml' });

    fireEvent.change(input, { target: { files: [first, second] } });

    expect(await screen.findByRole('tab', { name: 'second.puml' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'first.puml' })).toBeInTheDocument();
    expect(screen.queryByText('确认替换当前草稿')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Diagram source' })).toHaveValue('@startuml\nC -> D\n@enduml');
  });

  it('reports unreadable browser files without losing the readable ones', async () => {
    const { container } = render(<><Toaster /><DiagramEditor kind="plantuml" renderer={renderer} /></>);
    const broken = new File([], 'broken.puml');
    Object.defineProperty(broken, 'text', { value: async () => { throw new Error('文件已被移动'); } });
    const good = new File(['unused'], 'good.puml');
    Object.defineProperty(good, 'text', { value: async () => '@startuml\nA -> B\n@enduml' });

    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [broken, good] } });

    expect(await screen.findByRole('tab', { name: 'good.puml' })).toBeInTheDocument();
    expect(await screen.findByText('导入失败：broken.puml：文件已被移动')).toBeVisible();
    expect(screen.getByRole('button', { name: '导入源文件' })).toBeEnabled();
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
