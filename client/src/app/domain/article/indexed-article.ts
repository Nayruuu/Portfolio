import { Article } from './article';

/** An article paired with its position in the source list — a stable `@for` key and detail-link id. */
export interface IndexedArticle {
  article: Article;
  index: number;
}
