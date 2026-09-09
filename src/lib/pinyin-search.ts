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
