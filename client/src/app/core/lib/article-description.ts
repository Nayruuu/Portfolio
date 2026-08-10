import type { Article } from '../../domain';
import { truncateAtWord } from './truncate-at-word';

/** The entry's human-written description, word-boundary capped for meta/OG/JSON-LD use. */
export function articleDescription(article: Article, maxLength = 160): string {
  return article.description.length <= maxLength
    ? article.description
    : `${truncateAtWord(article.description, maxLength - 1)}…`;
}
