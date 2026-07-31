import { cn } from '@/lib/utils';
import { Textarea } from '@/components/ui/textarea';
import { KeyValueEditor } from './KeyValueEditor';
import type { RequestBody, BodyType } from '@/store/api-tester-store';

interface BodyEditorProps {
  body: RequestBody;
  onChange: (body: RequestBody) => void;
}

const BODY_TYPES: { value: BodyType; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'json', label: 'JSON' },
  { value: 'form-data', label: 'Form Data' },
  { value: 'x-www-form-urlencoded', label: 'URL Encoded' },
  { value: 'xml', label: 'XML' },
  { value: 'text', label: 'Text' },
];

export function BodyEditor({ body, onChange }: BodyEditorProps) {
  return (
    <div className="space-y-3">
      {/* Body Type Selector */}
      <div className="flex flex-wrap gap-1">
        {BODY_TYPES.map((bt) => (
          <button
            key={bt.value}
            onClick={() => onChange({ ...body, type: bt.value })}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              body.type === bt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {bt.label}
          </button>
        ))}
      </div>

      {/* Body Content */}
      {body.type === 'none' && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          该请求没有请求体
        </p>
      )}

      {body.type === 'form-data' ? (
        <KeyValueEditor
          items={body.formData}
          onChange={(formData) => onChange({ ...body, formData })}
          keyPlaceholder="字段名"
          valuePlaceholder="字段值"
        />
      ) : (
        body.type !== 'none' && (
          <Textarea
            value={body.content}
            onChange={(e) => onChange({ ...body, content: e.target.value })}
            placeholder={
              body.type === 'json'
                ? '{"key": "value"}'
                : body.type === 'xml'
                  ? '<root></root>'
                  : '请求体内容...'
            }
            className="min-h-[160px] resize-y font-mono text-sm"
            spellCheck={false}
          />
        )
      )}
    </div>
  );
}
