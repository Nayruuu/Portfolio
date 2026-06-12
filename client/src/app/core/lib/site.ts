import type { Lang } from '../../domain';

/** Canonical production origin (no trailing slash). Azure SWA custom domain. */
export const SITE_ORIGIN = 'https://super-dev.app';
/** Site name for OpenGraph / JSON-LD publisher. */
export const SITE_NAME = 'super-dev.app';
/** Default social share image (ships from app/public/ → served at /). */
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-default.png`;

/** Portfolio owner identity (author of the JSON-LD BlogPosting). */
export const AUTHOR = { name: 'Stéphane De Todaro', url: SITE_ORIGIN } as const;

/** og:locale per language. */
export const OG_LOCALE: Record<Lang, string> = { fr: 'fr_FR', en: 'en_US' };
/** Twin language (for hreflang alternates and the FR/EN toggle URL). */
export const TWIN_LANG: Record<Lang, Lang> = { fr: 'en', en: 'fr' };
