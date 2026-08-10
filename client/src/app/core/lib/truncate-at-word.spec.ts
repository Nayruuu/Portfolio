import { describe, expect, it } from 'vitest';
import { truncateAtWord } from './truncate-at-word';

describe('truncateAtWord', () => {
  it('returns short text unchanged', () => {
    expect(truncateAtWord('short bio', 48)).toBe('short bio');
  });

  it('returns text exactly at the limit unchanged', () => {
    expect(truncateAtWord('a'.repeat(48), 48)).toBe('a'.repeat(48));
  });

  it('cuts back to the last word boundary instead of mid-word', () => {
    expect(truncateAtWord('Full-stack developer building serious things', 20)).toBe(
      'Full-stack developer',
    );
  });

  it('keeps a word ending exactly at the limit', () => {
    expect(truncateAtWord('one two three', 7)).toBe('one two');
  });

  it('hard-cuts a single unbroken word longer than the limit', () => {
    expect(truncateAtWord('supercalifragilistic', 10)).toBe('supercalif');
  });

  it('trims a trailing space left by the cut', () => {
    expect(truncateAtWord('one  two', 4)).toBe('one');
  });
});
