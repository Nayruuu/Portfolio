import { describe, it, expect } from 'vitest';
import { FR } from './content.fr';
import { EN } from './content.en';
import { ARTICLE_TAGS, type Content } from '../../domain';
import { ARTICLE_BODIES } from './article-bodies';

/**
 * The `Content` type guarantees the shape; this test guarantees the *data*
 * stays aligned between FR and EN (same element counts) — otherwise the UI
 * would show different lengths depending on the language.
 */
describe('Content — FR / EN alignment', () => {
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

  for (const key of arrayKeys) {
    it(`${key} has the same length in FR and EN`, () => {
      expect((EN[key] as unknown[]).length).toBe((FR[key] as unknown[]).length);
    });
  }
});

describe('article tag vocabulary', () => {
  for (const [lang, content] of [
    ['FR', FR],
    ['EN', EN],
  ] as const) {
    it(`every ${lang} article tag is in the canonical ARTICLE_TAGS`, () => {
      for (const article of content.articles) {
        expect(ARTICLE_TAGS as readonly string[]).toContain(article.tag);
      }
    });

    it(`${lang} has 3 semantic + ARTICLE_TAGS.length tag pills`, () => {
      expect(content.articleFilters.length).toBe(3 + ARTICLE_TAGS.length);
    });
  }
});

describe('article & series slugs', () => {
  for (const [lang, content] of [
    ['FR', FR],
    ['EN', EN],
  ] as const) {
    it(`${lang} article slugs are unique and kebab-case`, () => {
      const slugs = content.articles.map((article) => article.slug);

      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) {
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      }
    });

    it(`${lang} every article.series (if set) references an existing series slug`, () => {
      const seriesSlugs = new Set(content.series.map((series) => series.slug));

      for (const article of content.articles) {
        if (article.series) {
          expect(seriesSlugs.has(article.series)).toBe(true);
        }
      }
    });
  }

  it('FR and EN share the same article slug order', () => {
    expect(FR.articles.map((article) => article.slug)).toEqual(
      EN.articles.map((article) => article.slug),
    );
  });

  it('FR and EN share the same series slug order', () => {
    expect(FR.series.map((series) => series.slug)).toEqual(EN.series.map((series) => series.slug));
  });
});

describe('article bodies', () => {
  for (const [lang, content] of [
    ['fr', FR],
    ['en', EN],
  ] as const) {
    it(`every ${lang} article slug maps to a non-empty Markdown body`, () => {
      for (const article of content.articles) {
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
