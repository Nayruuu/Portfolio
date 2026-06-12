import { ARTICLE_TAGS, type Article, type IndexedArticle } from '../../domain';
import { readCount } from './read-count';

/**
 * Filter selection as an index into `articleFilters`. The first three slots are semantic
 * (all / recent / popular); any higher index is a tag filter, mapped to `ARTICLE_TAGS` by
 * `selected - 3`. Indexing by position (not the localized label text) keeps matching stable
 * across locales — "Tuto"/"Tutorial" both resolve to the canonical `TUTO`.
 */
export const ARTICLE_FILTER = { ALL: 0, RECENT: 1, POPULAR: 2 } as const;

/** Index of the first tag pill in `articleFilters` (after all/recent/popular). */
const FIRST_TAG_INDEX = 3;

/** How many articles the "recent" filter keeps. */
const RECENT_COUNT = 6;

/**
 * Pure article selection for the articles tab: the articles to display (each with its source
 * index) for the given filter index. Pure on purpose — fully testable, keeping the component a
 * thin reactive shell.
 */
export function selectArticles(articles: readonly Article[], selected: number): IndexedArticle[] {
  const indexed = articles.map((article, index) => ({ article, index }));

  if (selected === ARTICLE_FILTER.ALL) {
    return indexed;
  }
  if (selected === ARTICLE_FILTER.RECENT) {
    return indexed.slice(0, RECENT_COUNT);
  }
  if (selected === ARTICLE_FILTER.POPULAR) {
    return [...indexed].sort(
      (first, second) => readCount(second.article.reads) - readCount(first.article.reads),
    );
  }

  const tag = ARTICLE_TAGS[selected - FIRST_TAG_INDEX];

  if (tag === undefined) {
    return [];
  }

  return indexed.filter(({ article }) => article.tag.toLowerCase() === tag.toLowerCase());
}
