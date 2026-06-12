import type { Article } from '../../domain';

/** Plain-text, length-capped description (strips the `$ ` shell prefix from titles). */
export function articleDescription(article: Article, maxLength = 160): string {
  const description = `${article.tag} · ${article.title.replace(/^\$\s*/, '')} · ${article.readTime}`;

  return description.length <= maxLength
    ? description
    : `${description.slice(0, maxLength - 1).trimEnd()}…`;
}
