import { pinyin } from 'pinyin-pro';

export function toPinyinBlob(text: string) {
  const full = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join('')
    .toLowerCase()
    .replace(/\s+/g, '');
  const initials = pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' })
    .join('')
    .toLowerCase()
    .replace(/\s+/g, '');
  return `${full} ${initials}`;
}

export function buildToolSearchText(parts: Array<string | string[] | undefined>) {
  const text = parts
    .flat()
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return `${text} ${toPinyinBlob(text)}`.toLowerCase();
}

export function matchesSearchText(searchText: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return needle.split(/\s+/).every((token) => searchText.includes(token));
}

/** 名称精确、前缀、包含、多词匹配依次优先，其他字段命中排在其后。 */
export function getNameMatchRank(names: string[], query: string) {
  const needle = query.trim().toLowerCase();
  const compact = needle.replace(/\s+/g, '');
  if (!compact) return 4;

  return Math.min(...names.map((name) => {
    const normalized = name.toLowerCase();
    const compactName = normalized.replace(/\s+/g, '');
    if (compactName === compact) return 0;
    if (compactName.startsWith(compact)) return 1;
    if (compactName.includes(compact)) return 2;
    if (matchesSearchText(normalized, needle)) return 3;
    return 4;
  }), 4);
}
