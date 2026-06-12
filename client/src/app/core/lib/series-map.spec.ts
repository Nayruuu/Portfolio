import { describe, it, expect } from 'vitest';
import { articleIdxsForSeries, seriesArticleMap, seriesIdxForArticle } from '.';
import type { Article, Series } from '../../domain';

/** Minimal Article factory — only the fields the series mapping reads need to be realistic. */
function art(slug: string, series?: string, seriesOrder?: number): Article {
  return {
    slug,
    tag: '.NET',
    title: slug,
    reads: '1k',
    ago: '1 j',
    readTime: '5 min',
    accentColor: '#fff',
    symbol: '#',
    date: '2026-01-01',
    description: 'd',
    series,
    seriesOrder,
  };
}

const SERIES: Series[] = [
  { slug: 's0', title: 'S0', description: 'd', colors: ['#000'], symbol: 'x' },
  { slug: 's1', title: 'S1', description: 'd', colors: ['#000'], symbol: 'y' },
];

describe('series-map', () => {
  describe('seriesArticleMap', () => {
    it('groups article indices by series slug, ordered by seriesOrder', () => {
      expect(seriesArticleMap([art('a', 's', 2), art('b', 's', 1)])).toEqual({ s: [1, 0] });
    });

    it('omits articles with no series, and tolerates a missing seriesOrder (?? 0)', () => {
      expect(seriesArticleMap([art('a', 's'), art('b'), art('c', 's', 1)])).toEqual({ s: [0, 2] });
    });

    it('treats every missing seriesOrder as 0 (both comparands hit the ?? 0 fallback)', () => {
      expect(seriesArticleMap([art('a', 's'), art('b', 's')])).toEqual({ s: [0, 1] });
    });

    it('returns {} when no article belongs to a series', () => {
      expect(seriesArticleMap([art('a'), art('b')])).toEqual({});
    });
  });

  describe('articleIdxsForSeries', () => {
    it('returns member indices ordered by seriesOrder', () => {
      const articles = [art('a', 's', 2), art('b'), art('c', 's', 1)];

      expect(articleIdxsForSeries(articles, 's')).toEqual([2, 0]);
    });

    it('returns [] for an unknown series slug (?? [] branch)', () => {
      expect(articleIdxsForSeries([art('a')], 'none')).toEqual([]);
    });
  });

  describe('seriesIdxForArticle', () => {
    it('finds the series index by the article series slug', () => {
      expect(seriesIdxForArticle(SERIES, art('a', 's1'))).toBe(1);
    });

    it('returns -1 when the article has no series', () => {
      expect(seriesIdxForArticle(SERIES, art('a'))).toBe(-1);
    });

    it('returns -1 when the series slug is not found', () => {
      expect(seriesIdxForArticle(SERIES, art('a', 'unknown'))).toBe(-1);
    });
  });
});
