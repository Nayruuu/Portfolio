import type { Lang } from '../../domain';

/** Canonical production origin (no trailing slash). Azure SWA custom domain. */
export const SITE_ORIGIN = 'https://super-dev.app';
/** Site name for OpenGraph / JSON-LD publisher. */
export const SITE_NAME = 'super-dev.app';
/** Default social share image (ships from app/public/ → served at /). */
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-default.png`;

/** Public profiles for the JSON-LD Person `sameAs` (the identity anchors, ordered by strength). */
export const SOCIAL_URLS = [
  'https://github.com/Nayruuu',
  'https://www.linkedin.com/in/st%C3%A9phane-d-930048b3/',
  'https://www.malt.fr/profile/stephanedetodaro1',
] as const;

/**
 * Stable identifier for the one canonical Person entity. Reused verbatim as the JSON-LD `@id` on
 * every page (home, articles, about) so search/AI engines fold all author nodes into ONE entity
 * instead of ~23 unlinked look-alikes.
 */
export const PERSON_ID = `${SITE_ORIGIN}/#stephane`;

/**
 * The canonical Person entity — every fact here is sourced from the site content / CV (start year
 * kept as "depuis 2017", not a computed age that would rot). Used as-is in every graph.
 */
export const PERSON = {
  '@type': 'Person',
  '@id': PERSON_ID,
  name: 'Stéphane De Todaro',
  alternateName: 'Nayruuu',
  url: SITE_ORIGIN,
  image: `${SITE_ORIGIN}/avatar.jpg`,
  jobTitle: 'Lead technique, architecte full-stack',
  description:
    'Lead technique et architecte full-stack, freelance depuis 2018, spécialisé en .NET, Angular, ' +
    'Azure et l’industrialisation de plateformes logicielles.',
  knowsAbout: [
    '.NET',
    '.NET Aspire',
    'C#',
    'Angular',
    'TypeScript',
    'Microsoft Azure',
    'Terraform',
    'GraphQL',
    'DevOps',
    'Software architecture',
    'Flutter',
    'WebGPU',
  ],
  sameAs: [...SOCIAL_URLS],
  subjectOf: {
    '@type': 'CreativeWork',
    name: 'CV — Stéphane De Todaro',
    url: `${SITE_ORIGIN}/cv/stephane-de-todaro-fr.pdf`,
  },
};

/** og:locale per language. */
export const OG_LOCALE: Record<Lang, string> = {
  fr: 'fr_FR',
  en: 'en_US',
};
