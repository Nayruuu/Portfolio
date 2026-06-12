import type { Article, Chapter, Content, ContactMethod } from '../../domain';
import data from './content.fr.json';

/** `Content` with the closed-union fields widened back to what a JSON import yields (`string`). */
type JsonContent = Omit<Content, 'articles' | 'chapters' | 'contact'> & {
  articles: (Omit<Article, 'tag'> & { tag: string })[];
  chapters: (Omit<Chapter, 'id'> & { id: string })[];
  contact: Omit<Content['contact'], 'altMethods'> & {
    altMethods: (Omit<ContactMethod, 'kind'> & { kind: string })[];
  };
};

/**
 * FR content — lives in `content.fr.json`, typed `Content`.
 * `satisfies JsonContent` keeps the compile-time completeness check (every field present,
 * FR/EN aligned); `as Content` recovers the closed-union types the JSON import widens to `string`.
 */
export const FR = data satisfies JsonContent as Content;
