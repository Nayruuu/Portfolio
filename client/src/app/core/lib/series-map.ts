import type { Article } from '../../domain';

/**
 * Series ↔ articles mapping, derived from each article's `series` (a series slug) +
 * `seriesOrder`. Returns `seriesSlug → article indices` (into the given `articles`),
 * each list ordered by `seriesOrder` ascending.
 */
export function seriesArticleMap(articles: readonly Article[]): Record<string, number[]> {
  const map: Record<string, number[]> = {};

  for (const [index, article] of articles.entries()) {
    if (article.series) {
      (map[article.series] ??= []).push(index);
    }
  }
  for (const slug of Object.keys(map)) {
    map[slug].sort(
      (first, second) => (articles[first].seriesOrder ?? 0) - (articles[second].seriesOrder ?? 0),
    );
  }

  return map;
}
