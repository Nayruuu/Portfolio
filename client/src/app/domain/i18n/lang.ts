/** Supported UI languages — value set + derived type (single source of truth). */
export const LANG = { FR: 'fr', EN: 'en', ES: 'es', DE: 'de' } as const;

export type Lang = (typeof LANG)[keyof typeof LANG];

/** Every supported language, in order — the single lever: add one here to light it up everywhere. */
export const LANGS: readonly Lang[] = Object.values(LANG);

/** Default language — `/` and unknown paths redirect here; SEO `x-default`. */
export const DEFAULT_LANG: Lang = LANG.FR;

/** Narrows an arbitrary string to a supported `Lang`. */
export function isLang(value: string | undefined): value is Lang {
  return value !== undefined && (LANGS as readonly string[]).includes(value);
}
