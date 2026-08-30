import { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'sql-formatter';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToolLogger } from '@/hooks/use-tool-logger';
import { syncFormatterValuePreservingFormat } from '@/lib/formatter-sync';
import { AlertCircle } from 'lucide-react';

type SqlDialect =
  | 'sql'
  | 'mysql'
  | 'postgresql'
  | 'sqlite'
  | 'mariadb'
  | 'bigquery'
  | 'db2'
  | 'hive'
  | 'n1ql'
  | 'plsql'
  | 'redshift'
  | 'spark'
  | 'tsql';

const DIALECTS: { value: SqlDialect; label: string }[] = [
  { value: 'sql', label: 'Standard SQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'postgresql', label: 'PostgreSQL' },
  { value: 'sqlite', label: 'SQLite' },
  { value: 'mariadb', label: 'MariaDB' },
  { value: 'tsql', label: 'SQL Server' },
  { value: 'plsql', label: 'Oracle PL/SQL' },
  { value: 'bigquery', label: 'BigQuery' },
  { value: 'redshift', label: 'Redshift' },
  { value: 'spark', label: 'Spark SQL' },
  { value: 'hive', label: 'Hive' },
  { value: 'db2', label: 'DB2' },
];

export default function SqlFormatter() {
  const [input, setInput] = useState('');
  const [dialect, setDialect] = useState<SqlDialect>('sql');
  const [uppercase, setUppercase] = useState('true');
  const [output, setOutput] = useState('');
  const skipOutputSync = useRef(false);
  const log = useToolLogger('sql-formatter');

  const { formattedOutput, error } = useMemo(() => {
    if (!input.trim()) return { formattedOutput: '', error: null };

    try {
      const result = format(input, {
        language: dialect,
        keywordCase: uppercase === 'true' ? 'upper' : 'preserve',
        tabWidth: 2,
        linesBetweenQueries: 2,
      });
      log.info('SQL 格式化成功', {
        dialect,
        inputLength: input.length,
        outputLength: result.length,
      });
      return { formattedOutput: result, error: null };
    } catch (e) {
      log.warn('SQL 格式化错误', { message: (e as Error).message });
      return { formattedOutput: '', error: (e as Error).message };
    }
  }, [input, dialect, uppercase, log]);

  useEffect(() => {
    if (skipOutputSync.current) {
      skipOutputSync.current = false;
      return;
    }
    setOutput(formattedOutput);
  }, [formattedOutput, input]);

  const sampleSql = `SELECT u.id, u.name, u.email, COUNT(o.id) as order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.created_at > '2024-01-01' AND u.status = 'active' GROUP BY u.id, u.name, u.email HAVING COUNT(o.id) > 5 ORDER BY order_count DESC LIMIT 10;`;

  return (
    <ToolLayout
      inputTitle="SQL 输入"
      outputTitle="格式化结果（可编辑）"
      outputValue={output}
      onClear={() => {
        setInput('');
        setOutput('');
      }}
      inputActions={
        <div className="flex items-center gap-2">
          <Select
            value={dialect}
            onChange={(e) => {
              const value = e.target.value as SqlDialect;
              setDialect(value);
              log.info('切换 SQL 方言', { dialect: value });
            }}
            options={DIALECTS}
            className="h-8 w-32 text-xs"
          />
          <Select
            value={uppercase}
            onChange={(e) => setUppercase(e.target.value)}
            options={[
              { value: 'true', label: '关键字大写' },
              { value: 'false', label: '保持原样' },
            ]}
            className="h-8 w-28 text-xs"
          />
          <Button variant="ghost" size="sm" onClick={() => setInput(sampleSql)}>
            示例
          </Button>
        </div>
      }
      input={
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="输入 SQL 查询..."
          className="h-full resize-none font-mono text-sm"
          spellCheck={false}
        />
      }
      output={
        <div className="relative h-full">
          <Textarea
            value={output}
            onChange={(e) => {
              skipOutputSync.current = true;
              setOutput(e.target.value);
              setInput(syncFormatterValuePreservingFormat(input, output, e.target.value));
            }}
            placeholder="结果（可编辑，修改后同步左侧）..."
            className="h-full resize-none bg-muted/50 font-mono text-sm"
            spellCheck={false}
          />
          {error && (
            <div className="pointer-events-none absolute left-3 right-3 top-3 z-10 flex items-start gap-2 rounded-md border border-destructive/50 bg-background/95 p-2 shadow-sm">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-destructive">格式化错误</p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{error}</p>
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}
