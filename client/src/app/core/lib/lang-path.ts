import type { Lang } from '../../domain';

/** Swaps the leading `/:lang` segment of an app path to `lang` (e.g. `/fr/articles/x` → `/es/articles/x`). */
export function pathInLang(path: string, lang: Lang): string {
  return path.replace(/^\/[a-z]{2}(?=\/|$)/, `/${lang}`);
}
