// Re-export types from atoms (single source of truth)
export type { Language, Translate, TranslationKey } from "../atoms/i18n.ts";
export { languageAtom, tAtom } from "../atoms/i18n.ts";

import { useAtomValue, useSetAtom } from "solid-jotai";
import { languageAtom, tAtom, type Translate } from "../atoms/i18n.ts";

export function useI18n() {
  // `language` is the reactive accessor (call as `language()`), and `t` reads
  // the current table on EVERY call so translated strings re-render live when
  // the language changes. Returning frozen snapshots here (e.g. `t: tGetter()`)
  // would leave the UI stuck on the mount-time language until a full reload.
  const language = useAtomValue(languageAtom);
  const setLanguage = useSetAtom(languageAtom);
  const tGetter = useAtomValue(tAtom);
  const t: Translate = (key) => tGetter()(key);
  return { language, setLanguage, t };
}
