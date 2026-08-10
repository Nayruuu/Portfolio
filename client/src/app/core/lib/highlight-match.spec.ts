import { describe, expect, it } from 'vitest';
import { highlightMatch } from './highlight-match';

describe('highlightMatch', () => {
  it('returns an empty array for an empty label', () => {
    expect(highlightMatch('', 'a')).toEqual([]);
  });

  it('returns the whole label as one unmatched run for an empty query', () => {
    expect(highlightMatch('Home', '')).toEqual([{ text: 'Home', hit: false }]);
  });

  it('returns the whole label unmatched when the query does not match', () => {
    expect(highlightMatch('Home', 'xyz')).toEqual([{ text: 'Home', hit: false }]);
  });

  it('splits into matched and unmatched runs, merging adjacent same-state chars', () => {
    expect(highlightMatch('abcd', 'ab')).toEqual([
      { text: 'ab', hit: true },
      { text: 'cd', hit: false },
    ]);
  });

  it('alternates single-char runs for a scattered subsequence', () => {
    expect(highlightMatch('abcd', 'ac')).toEqual([
      { text: 'a', hit: true },
      { text: 'b', hit: false },
      { text: 'c', hit: true },
      { text: 'd', hit: false },
    ]);
  });

  it('highlights the earliest occurrence of each query char (greedy first-match)', () => {
    expect(highlightMatch('banana', 'na')).toEqual([
      { text: 'ba', hit: false },
      { text: 'na', hit: true },
      { text: 'na', hit: false },
    ]);
  });

  it('is case-insensitive while preserving the label casing', () => {
    expect(highlightMatch('Contact', 'con')).toEqual([
      { text: 'Con', hit: true },
      { text: 'tact', hit: false },
    ]);
  });

  it('highlights accented characters against a folded-case query', () => {
    expect(highlightMatch('Séries', 'séri')).toEqual([
      { text: 'Séri', hit: true },
      { text: 'es', hit: false },
    ]);
  });
});
