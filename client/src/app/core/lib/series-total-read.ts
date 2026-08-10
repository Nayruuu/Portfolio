import type { Article } from '../../domain';

/** Parse the leading integer of a readTime label ("8 min" → 8); 0 if unparseable. */
function readMinutes(readTime: string): number {
  const parsed = parseInt(readTime, 10);

  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Total reading time of a series, derived from its mapped articles' `readTime` — so the figure
 * shown in the series list and detail is real, never a hardcoded vanity number. Formats
 * `"YY min"` under an hour, else `"Xh YY"` (zero-padded minutes).
 */
export function seriesTotalRead(
  articles: readonly Article[],
  articleIndices: readonly number[],
): string {
  const minutes = articleIndices.reduce((total, index) => {
    const article = articles[index];

    return total + (article ? readMinutes(article.readTime) : 0);
  }, 0);

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  return `${hours}h ${String(remainder).padStart(2, '0')}`;
}
