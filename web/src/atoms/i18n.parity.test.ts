import { expect, test } from "bun:test";

/**
 * i18n ja/en parity guard. `TranslationKey` is `keyof typeof translations.ja`
 * and the runtime fallback renders the raw key, so a key added to `ja` but not
 * `en` (or left empty) produces NO compile error and silently ships a raw-key
 * string to English users. These tests fail loudly on that drift instead.
 */

// i18n.ts reads localStorage / navigator at module load (detectLanguage). Shim
// them before importing so the module evaluates outside a browser.
// Returning a concrete language for "language" makes detectLanguage resolve
// before it touches navigator (whose `.language` is absent in this runtime).
const g = globalThis as Record<string, unknown>;
g.localStorage ??= {
  getItem: (k: string) => (k === "language" ? "en" : null),
  setItem: () => {},
  removeItem: () => {},
};

const { __i18nTranslations: translations } = await import("./i18n.ts");

const jaKeys = Object.keys(translations.ja);
const enKeys = Object.keys(translations.en);

test("ja and en have the exact same key set", () => {
  const missingInEn = jaKeys.filter((k) => !(k in translations.en));
  const extraInEn = enKeys.filter((k) => !(k in translations.ja));
  expect({ missingInEn, extraInEn }).toEqual({
    missingInEn: [],
    extraInEn: [],
  });
});

test("no translation value is empty in either language", () => {
  const empties: string[] = [];
  for (const [lang, table] of Object.entries(translations)) {
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== "string" || value.trim() === "") {
        empties.push(`${lang}.${key}`);
      }
    }
  }
  expect(empties).toEqual([]);
});
