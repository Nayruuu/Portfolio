import type { Article } from '../../domain';
import { seriesArticleMap } from './series-map';

/** Article indices (into `articles`) that make up a series, ordered by seriesOrder. */
export function articleIdxsForSeries(articles: readonly Article[], seriesSlug: string): number[] {
  return seriesArticleMap(articles)[seriesSlug] ?? [];
}
