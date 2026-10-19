import { useTranslation } from 'react-i18next';

export function useAiText() {
  const { i18n } = useTranslation();
  return (zh: string, en: string) => i18n.language.startsWith('zh') ? zh : en;
}

export function iconLabel(label: string) { return { title: label, 'aria-label': label }; }
