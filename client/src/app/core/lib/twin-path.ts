import type { Lang } from '../../domain';
import { TWIN_LANG } from './site';

/** Twin-language path: swaps only the leading `/:lang` segment. */
export function twinPath(path: string, lang: Lang): string {
  return path.replace(new RegExp(`^/${lang}(?=/|$)`), `/${TWIN_LANG[lang]}`);
}
