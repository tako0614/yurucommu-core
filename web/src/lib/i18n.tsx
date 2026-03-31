// Re-export types from atoms (single source of truth)
export type { Language, TranslationKey, Translate } from '../atoms/i18n.ts';
export { languageAtom, tAtom } from '../atoms/i18n.ts';

import { useAtomValue, useSetAtom } from 'solid-jotai';
import { languageAtom, tAtom } from '../atoms/i18n.ts';

export function useI18n() {
  const language = useAtomValue(languageAtom);
  const setLanguage = useSetAtom(languageAtom);
  const tGetter = useAtomValue(tAtom);
  return { language: language(), setLanguage, t: tGetter() };
}
