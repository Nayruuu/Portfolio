import { describe, it, expect } from 'vitest';
import { seriesTotalRead } from './series-total-read';
import type { Article } from '../../domain';

function art(readTime: string): Article {
  return {
    slug: 'x',
    tag: '.NET',
    title: 'x',
    reads: '1k',
    ago: '1 j',
    readTime,
    accentColor: '#fff',
    symbol: '#',
    date: '2026-01-01',
    description: 'd',
  };
}

describe('seriesTotalRead()', () => {
  it("sums the mapped articles' readTime and formats minutes (< 60)", () => {
    const articles = [art('8 min'), art('6 min'), art('11 min')];

    expect(seriesTotalRead(articles, [0, 1, 2])).toBe('25 min');
  });

  it('formats hours + zero-padded minutes (≥ 60)', () => {
    const articles = [art('40 min'), art('35 min')]; // 75

    expect(seriesTotalRead(articles, [0, 1])).toBe('1h 15');
  });

  it('formats an exact hour with no leftover minutes', () => {
    const articles = [art('30 min'), art('30 min')]; // 60

    expect(seriesTotalRead(articles, [0, 1])).toBe('1h 00');
  });

  it('returns "0 min" for an empty series', () => {
    expect(seriesTotalRead([art('8 min')], [])).toBe('0 min');
  });

  it('treats an unparseable readTime as 0 minutes', () => {
    expect(seriesTotalRead([art('n/a'), art('10 min')], [0, 1])).toBe('10 min');
  });

  it('ignores indices out of range (defensive)', () => {
    const articles = [art('10 min')];

    expect(seriesTotalRead(articles, [0, 99])).toBe('10 min');
  });
});
