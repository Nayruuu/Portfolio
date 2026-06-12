import { describe, it, expect } from 'vitest';
import { ARTICLE_FILTER, readCount, selectArticles } from '.';
import type { Article, ArticleTag } from '../../domain';

/** Minimal Article factory — only the fields the selection logic reads need to be realistic. */
function art(tag: ArticleTag, reads: string, title: string = tag): Article {
  return {
    slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    tag,
    title,
    reads,
    ago: '1 j',
    readTime: '5 min',
    accentColor: '#fff',
    symbol: '#',
    date: '2026-01-01',
    description: 'd',
  };
}

/** 8 fixtures (> RECENT_COUNT) with mixed reads magnitudes to exercise every branch. */
const ARTICLES: Article[] = [
  art('.NET', '892 lectures', 'a0'),
  art('ANGULAR', '2,4k lectures', 'a1'),
  art('AZURE', '1,2M lectures', 'a2'),
  art('.NET', '5,2k lectures', 'a3'),
  art('ANGULAR', '300 lectures', 'a4'),
  art('AZURE', '7,1k lectures', 'a5'),
  art('.NET', '12 lectures', 'a6'),
  art('ANGULAR', '4,4k lectures', 'a7'),
];

describe('readCount()', () => {
  it('honours the position suffix (FR/EN, case-insensitive)', () => {
    expect(readCount('2,4k lectures')).toBe(2400);
    expect(readCount('8.2K reads')).toBe(8200);
  });

  it('honours the M suffix', () => {
    expect(readCount('1,2M lectures')).toBe(1_200_000);
  });

  it('parses a plain count with no magnitude suffix', () => {
    expect(readCount('892 lectures')).toBe(892);
  });
});

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

  it('POPULAR sorts by descending read count, honouring position/M', () => {
    const rows = selectArticles(ARTICLES, ARTICLE_FILTER.POPULAR);
    const counts = rows.map((row) => readCount(row.article.reads));

    for (let position = 1; position < counts.length; position++) {
      expect(counts[position]).toBeLessThanOrEqual(counts[position - 1]);
    }
    expect(rows[0].article.reads).toBe('1,2M lectures');
    expect(rows.at(-1)?.article.reads).toBe('12 lectures');
    expect([...rows].map((row) => row.index).sort((first, second) => first - second)).toEqual(
      ARTICLES.map((_, index) => index),
    );
  });

  it('a tag index (≥ 3) keeps only that canonical tag, case-insensitive, preserving indices', () => {
    const rows = selectArticles(ARTICLES, 3); // ARTICLE_TAGS[0] = '.NET'

    expect(rows.map((row) => row.index)).toEqual([0, 3, 6]);
    expect(rows.every((row) => row.article.tag === '.NET')).toBe(true);
  });

  it('a tag index with no matching article returns an empty list', () => {
    const rows = selectArticles(ARTICLES, 6); // ARTICLE_TAGS[3] = 'FLUTTER' — none in fixtures

    expect(rows).toEqual([]);
  });

  it('an out-of-range index (≥ 3 + ARTICLE_TAGS.length) returns an empty list (defensive)', () => {
    const rows = selectArticles(ARTICLES, 99);

    expect(rows).toEqual([]);
  });
});
