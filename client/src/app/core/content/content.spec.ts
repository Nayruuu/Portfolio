import { describe, it, expect } from 'vitest';
import { FR } from './content.fr';
import { EN } from './content.en';
import { ES } from './content.es';
import { DE } from './content.de';
import { ARTICLE_TAGS, LANGS, type Content, type Lang } from '../../domain';
import { ARTICLE_BODIES } from './article-bodies';

/** Every locale bridge, keyed by `Lang`, and the FR source they must stay aligned with. */
const LOCALES = { fr: FR, en: EN, es: ES, de: DE } satisfies Record<Lang, Content>;
const NON_SOURCE = LANGS.filter((lang) => lang !== 'fr');

/**
 * The `Content` type guarantees the *shape*; this test guarantees the *data* stays aligned across
 * every locale (same element counts, same slug order) — otherwise the UI would show different
 * lengths/links depending on the language. AI-generated locales are validated here, not just typed.
 */
describe('Content — cross-locale alignment', () => {
  const arrayKeys: (keyof Content)[] = [
    'tabs',
    'articles',
    'series',
    'chapters',
    'articleFilters',
    'comments',
    'projects',
    'featuredTags',
    'descriptionMeta',
    'descriptionMetaValues',
  ];

  for (const lang of NON_SOURCE) {
    for (const key of arrayKeys) {
      it(`${lang}.${String(key)} has the same length as FR`, () => {
        expect((LOCALES[lang][key] as unknown[]).length).toBe((FR[key] as unknown[]).length);
      });
    }

    it(`${lang} shares the FR article slug order`, () => {
      expect(LOCALES[lang].articles.map((article) => article.slug)).toEqual(
        FR.articles.map((article) => article.slug),
      );
    });

    it(`${lang} shares the FR series slug order`, () => {
      expect(LOCALES[lang].series.map((series) => series.slug)).toEqual(
        FR.series.map((series) => series.slug),
      );
    });
  }
});

describe('article tag vocabulary', () => {
  for (const lang of LANGS) {
    it(`every ${lang} article tag is in the canonical ARTICLE_TAGS`, () => {
      for (const article of LOCALES[lang].articles) {
        expect(ARTICLE_TAGS as readonly string[]).toContain(article.tag);
      }
    });

    it(`${lang} has 3 semantic + ARTICLE_TAGS.length tag pills`, () => {
      expect(LOCALES[lang].articleFilters.length).toBe(3 + ARTICLE_TAGS.length);
    });
  }
});

describe('article & series slugs', () => {
  for (const lang of LANGS) {
    it(`${lang} article slugs are unique and kebab-case`, () => {
      const slugs = LOCALES[lang].articles.map((article) => article.slug);

      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) {
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    });

    it(`${lang} every article.series (if set) references an existing series slug`, () => {
      const seriesSlugs = new Set(LOCALES[lang].series.map((series) => series.slug));

      for (const article of LOCALES[lang].articles) {
        if (article.series) {
          expect(seriesSlugs.has(article.series)).toBe(true);
        }
      }
    });
  }
});

describe('article bodies', () => {
  for (const lang of LANGS) {
    it(`every ${lang} article slug maps to a non-empty Markdown body`, () => {
      for (const article of LOCALES[lang].articles) {
        expect(ARTICLE_BODIES[article.slug]?.[lang] ?? '').not.toBe('');
      }
    });
  }

  it('has no orphan body — every ARTICLE_BODIES key maps to a content article slug', () => {
    const slugs = new Set(FR.articles.map((article) => article.slug));

    for (const slug of Object.keys(ARTICLE_BODIES)) {
      expect(slugs.has(slug)).toBe(true);
    }
  });
});
