import type { Article, Series } from '../../domain';

/** Index (into `series`) of the series an article belongs to, or -1. */
export function seriesIdxForArticle(series: readonly Series[], article: Article): number {
  return article.series ? series.findIndex((entry) => entry.slug === article.series) : -1;
}
