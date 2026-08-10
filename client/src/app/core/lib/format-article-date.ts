import type { Lang } from '../../domain';

/** Localized short date for article cards (`7 juil. 2026` / `Jul 7, 2026`), from the ISO date. */
export function formatArticleDate(isoDate: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`));
}
