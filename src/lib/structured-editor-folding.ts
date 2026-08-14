export type StructuredLanguage = 'json' | 'yaml' | 'xml';

export function hasFoldableStructure(value: string, language: StructuredLanguage): boolean {
  if (!value.includes('\n')) return false;

  if (language === 'yaml') {
    const lines = value.split(/\r?\n/);
    return lines.some((line, index) => {
      if (!line.trim() || line.trimStart().startsWith('#')) return false;
      const currentIndent = line.match(/^\s*/)?.[0].length ?? 0;
      const nextLine = lines.slice(index + 1).find((candidate) => {
        const trimmed = candidate.trim();
        return trimmed.length > 0 && !trimmed.startsWith('#');
      });
      const nextIndent = nextLine?.match(/^\s*/)?.[0].length ?? 0;
      return nextIndent > currentIndent;
    });
  }

  if (language === 'xml') {
    return /<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>\s*\r?\n[\s\S]*<\/\1>/.test(value);
  }

  return value.includes('{') || value.includes('[');
}
