import { useState, useRef, useCallback } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useIsDark } from '@/hooks/use-theme';
import { Columns2, Rows3, Eraser } from 'lucide-react';

type ViewMode = 'split' | 'unified';

const SAMPLE_ORIGINAL = `function greet(name) {
  console.log("Hello, " + name);
  return true;
}

const users = ["Alice", "Bob"];
users.forEach(greet);`;

const SAMPLE_MODIFIED = `function greet(name, greeting = "Hello") {
  console.log(\`\${greeting}, \${name}!\`);
  return true;
}

const users = ["Alice", "Bob", "Charlie"];
users.forEach((u) => greet(u, "Hi"));`;

export default function TextDiff() {
  const [original, setOriginal] = useState('');
  const [modified, setModified] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const isDark = useIsDark();
  const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);

  const handleEditorMount = useCallback((ed: editor.IStandaloneDiffEditor) => {
    editorRef.current = ed;

    const originalEditor = ed.getOriginalEditor();
    const modifiedEditor = ed.getModifiedEditor();

    originalEditor.onDidChangeModelContent(() => {
      setOriginal(originalEditor.getValue());
    });
    modifiedEditor.onDidChangeModelContent(() => {
      setModified(modifiedEditor.getValue());
    });
  }, []);

  const handleClear = () => {
    setOriginal('');
    setModified('');
    if (editorRef.current) {
      editorRef.current.getOriginalEditor().setValue('');
      editorRef.current.getModifiedEditor().setValue('');
    }
  };

  const handleSample = () => {
    setOriginal(SAMPLE_ORIGINAL);
    setModified(SAMPLE_MODIFIED);
    if (editorRef.current) {
      editorRef.current.getOriginalEditor().setValue(SAMPLE_ORIGINAL);
      editorRef.current.getModifiedEditor().setValue(SAMPLE_MODIFIED);
    }
  };

  return (
    <div className="flex h-full flex-col p-4">
      {/* Controls */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex rounded-md border">
          <Button
            variant={viewMode === 'split' ? 'default' : 'ghost'}
            size="sm"
            className="rounded-r-none"
            onClick={() => setViewMode('split')}
            title="并排视图"
          >
            <Columns2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewMode === 'unified' ? 'default' : 'ghost'}
            size="sm"
            className="rounded-l-none"
            onClick={() => setViewMode('unified')}
            title="行内视图"
          >
            <Rows3 className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Select
          value={viewMode}
          onChange={(e) => setViewMode(e.target.value as ViewMode)}
          options={[
            { value: 'split', label: '并排视图' },
            { value: 'unified', label: '行内视图' },
          ]}
          className="h-8 w-28 text-xs"
        />

        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={ignoreWhitespace}
            onChange={(e) => setIgnoreWhitespace(e.target.checked)}
            className="h-4 w-4 rounded border"
          />
          <span className="text-sm">忽略空白</span>
        </label>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleSample}>
            示例
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClear}>
            <Eraser className="mr-1 h-3.5 w-3.5" />
            清空
          </Button>
        </div>
      </div>

      {/* Monaco Diff Editor */}
      <div className="flex-1 overflow-hidden rounded-md border">
        <DiffEditor
          height="100%"
          language="plaintext"
          theme={isDark ? 'vs-dark' : 'light'}
          original={original}
          modified={modified}
          onMount={handleEditorMount}
          options={{
            renderSideBySide: viewMode === 'split',
            ignoreTrimWhitespace: ignoreWhitespace,
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            wordWrap: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            originalEditable: true,
            readOnly: false,
            renderWhitespace: 'selection',
            diffWordWrap: 'on',
          }}
        />
      </div>

      {/* Status hint */}
      <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
        <span>左侧: 原始文本</span>
        <span>右侧: 修改后文本</span>
        <span className="ml-auto">直接在编辑器中输入内容进行比对</span>
      </div>
    </div>
  );
}
