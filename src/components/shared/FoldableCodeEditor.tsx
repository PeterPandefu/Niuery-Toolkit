import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import '@/lib/monaco-setup';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTheme } from '@/hooks/use-theme';
import type { StructuredLanguage } from '@/lib/structured-editor-folding';

export type { StructuredLanguage } from '@/lib/structured-editor-folding';

export interface FoldableCodeEditorHandle {
  foldAll: () => Promise<void>;
  unfoldAll: () => Promise<void>;
}

interface FoldableCodeEditorProps {
  value: string;
  language: StructuredLanguage;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  tabSize?: number;
}

function runEditorAction(instance: editor.IStandaloneCodeEditor | null, actionId: string): Promise<void> {
  return instance?.getAction(actionId)?.run() ?? Promise.resolve();
}

export const FoldableCodeEditor = forwardRef<FoldableCodeEditorHandle, FoldableCodeEditorProps>(function FoldableCodeEditor(
  { value, language, onChange, readOnly = false, placeholder, tabSize = 2 },
  ref,
) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const { monacoTheme } = useTheme();

  useImperativeHandle(ref, () => ({
    foldAll: () => runEditorAction(editorRef.current, 'editor.foldAll'),
    unfoldAll: () => runEditorAction(editorRef.current, 'editor.unfoldAll'),
  }), []);

  const handleMount = useCallback((instance: editor.IStandaloneCodeEditor) => {
    editorRef.current = instance;
  }, []);

  return (
    <div className="h-full overflow-hidden rounded-md border">
      <Editor
        height="100%"
        language={language}
        theme={monacoTheme}
        value={value}
        onChange={(nextValue) => onChange?.(nextValue ?? '')}
        onMount={handleMount}
        options={{
          readOnly,
          domReadOnly: readOnly,
          minimap: { enabled: false },
          fontSize: 13,
          lineNumbers: 'on',
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize,
          folding: true,
          showFoldingControls: 'always',
          placeholder,
        }}
      />
    </div>
  );
});
