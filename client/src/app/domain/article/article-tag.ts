/**
 * The closed, locale-independent article tag vocabulary — value set + derived type
 * (single source of truth). Every `Article.tag` (in `content.*.json`) is one of these;
 * their order is consumed by `core/lib/select-articles.ts` (pill-position → tag mapping).
 */
export const ARTICLE_TAGS = ['.NET', 'ANGULAR', 'AZURE', 'FLUTTER', 'DEVOPS', 'TUTO'] as const;

export type ArticleTag = (typeof ARTICLE_TAGS)[number];
