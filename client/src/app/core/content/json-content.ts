import type { Article, Chapter, Content, ContactMethod } from '../../domain';

/**
 * `Content` with the closed-union fields widened back to what a JSON import yields (`string`).
 * Shared by every per-language bridge so the widening lives in one place. Each bridge does
 * `data satisfies JsonContent as Content`: `satisfies` keeps the compile-time completeness check
 * (every field present, all locales aligned); `as Content` recovers the closed-union types.
 */
export type JsonContent = Omit<Content, 'articles' | 'chapters' | 'contact'> & {
  articles: (Omit<Article, 'tag'> & { tag: string })[];
  chapters: (Omit<Chapter, 'id'> & { id: string })[];
  contact: Omit<Content['contact'], 'altMethods'> & {
    altMethods: (Omit<ContactMethod, 'kind'> & { kind: string })[];
  };
};
