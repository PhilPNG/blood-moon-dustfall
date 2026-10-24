/** Shared locale metadata contains no private story content. */
export type Language = 'en' | 'es' | 'pt-BR';
export const LANGUAGES: { value: Language; label: string; nativeLabel: string }[] = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'es', label: 'Spanish', nativeLabel: 'Español' },
  { value: 'pt-BR', label: 'Brazilian Portuguese', nativeLabel: 'Português (Brasil)' },
];
export function normalizeLanguage(value: unknown): Language {
  return value === 'es' || value === 'pt-BR' ? value : 'en';
}
