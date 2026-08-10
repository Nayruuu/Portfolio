import { describe, expect, it } from 'vitest';
import { formatArticleDate } from './format-article-date';

describe('formatArticleDate', () => {
  it('formats the ISO date in the requested locale', () => {
    expect(formatArticleDate('2026-07-07', 'fr')).toBe('7 juil. 2026');
    expect(formatArticleDate('2026-07-07', 'en')).toBe('Jul 7, 2026');
  });

  it('is timezone-stable (UTC pinned, no off-by-one day)', () => {
    expect(formatArticleDate('2026-01-01', 'en')).toBe('Jan 1, 2026');
  });
});
