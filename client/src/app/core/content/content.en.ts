import type { Article, Chapter, Content, ContactMethod } from '../../domain';
import data from './content.en.json';

/** `Content` with the closed-union fields widened back to what a JSON import yields (`string`). */
type JsonContent = Omit<Content, 'articles' | 'chapters' | 'contact'> & {
  articles: (Omit<Article, 'tag'> & { tag: string })[];
  chapters: (Omit<Chapter, 'id'> & { id: string })[];
  contact: Omit<Content['contact'], 'altMethods'> & {
    altMethods: (Omit<ContactMethod, 'kind'> & { kind: string })[];
  };
};

/**
 * EN content — lives in `content.en.json`, typed `Content`.
 * `satisfies JsonContent` keeps the compile-time completeness check (every field present,
 * FR/EN aligned); `as Content` recovers the closed-union types the JSON import widens to `string`.
 */
export const EN = data satisfies JsonContent as Content;
