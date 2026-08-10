import { describe, it, expect } from 'vitest';
import { ARTICLE_FILTER, selectArticles } from '.';
import type { Article, ArticleTag } from '../../domain';

/** Minimal Article factory — only the fields the selection logic reads need to be realistic. */
function art(tag: ArticleTag, title: string = tag): Article {
  return {
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    tag,
    title,
    readTime: '5 min',
    accentColor: '#fff',
    symbol: '#',
    date: '2026-01-01',
    description: 'd',
  };
}

/** 8 fixtures (> RECENT_COUNT) to exercise every branch. */
const ARTICLES: Article[] = [
  art('.NET', 'a0'),
  art('ANGULAR', 'a1'),
  art('AZURE', 'a2'),
  art('.NET', 'a3'),
  art('ANGULAR', 'a4'),
  art('AZURE', 'a5'),
  art('.NET', 'a6'),
  art('ANGULAR', 'a7'),
];

describe('selectArticles()', () => {
  it('ALL keeps every article in source order, each with its index', () => {
    const rows = selectArticles(ARTICLES, ARTICLE_FILTER.ALL);

    expect(rows.map((row) => row.index)).toEqual(ARTICLES.map((_, index) => index));
    expect(rows.every((row) => row.article === ARTICLES[row.index])).toBe(true);
  });

  it('RECENT keeps the first 6 in source order', () => {
    const rows = selectArticles(ARTICLES, ARTICLE_FILTER.RECENT);

    expect(rows.map((row) => row.index)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('a tag index (≥ 2) keeps only that canonical tag, case-insensitive, preserving indices', () => {
    const rows = selectArticles(ARTICLES, 2); // ARTICLE_TAGS[0] = '.NET'

    expect(rows.map((row) => row.index)).toEqual([0, 3, 6]);
    expect(rows.every((row) => row.article.tag === '.NET')).toBe(true);
  });

  it('a tag index with no matching article returns an empty list', () => {
    const rows = selectArticles(ARTICLES, 5); // ARTICLE_TAGS[3] = 'FLUTTER' — none in fixtures

    expect(rows).toEqual([]);
  });

  it('an out-of-range index (≥ 2 + ARTICLE_TAGS.length) returns an empty list (defensive)', () => {
    const rows = selectArticles(ARTICLES, 99);

    expect(rows).toEqual([]);
  });
});
