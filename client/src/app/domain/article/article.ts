import type { ArticleTag } from './article-tag';

export interface Article {
  /** URL slug — kebab-case, ASCII, identical FR/EN, equals the .md filename stem. */
  slug: string;
  tag: ArticleTag;
  title: string;
  reads: string;
  ago: string;
  readTime: string;
  accentColor: string;
  symbol: string;
  /** ISO date (YYYY-MM-DD) — powers JSON-LD datePublished. */
  date: string;
  /** Meta description (per locale). */
  description: string;
  /** Slug of the series this article belongs to (optional). */
  series?: string;
  /** Position within its series (1-based). */
  seriesOrder?: number;
}
