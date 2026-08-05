import { useState, useMemo } from 'react';
import { format } from 'sql-formatter';
import { ToolLayout } from '@/components/shared/ToolLayout';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useToolLogger } from '@/hooks/use-tool-logger';
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
  const log = useToolLogger('sql-formatter');

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: '', error: null };

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
      return { output: result, error: null };
    } catch (e) {
      log.warn('SQL 格式化错误', { message: (e as Error).message });
      return { output: '', error: (e as Error).message };
    }
  }, [input, dialect, uppercase, log]);

  const sampleSql = `SELECT u.id, u.name, u.email, COUNT(o.id) as order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.created_at > '2024-01-01' AND u.status = 'active' GROUP BY u.id, u.name, u.email HAVING COUNT(o.id) > 5 ORDER BY order_count DESC LIMIT 10;`;

  return (
    <ToolLayout
      inputTitle="SQL 输入"
      outputTitle="格式化结果"
      outputValue={output}
      onClear={() => setInput('')}
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
          {error ? (
            <div className="flex h-full items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4">
              <AlertCircle className="h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="font-medium text-destructive">格式化错误</p>
                <p className="mt-1 font-mono text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          ) : (
            <Textarea
              value={output}
              readOnly
              placeholder="结果..."
              className="h-full resize-none bg-muted/50 font-mono text-sm"
              spellCheck={false}
            />
          )}
        </div>
      }
    />
  );
}
