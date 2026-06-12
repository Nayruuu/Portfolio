import { describe, it, expect } from 'vitest';
import { focusedIndex } from './focused-index';

describe('focusedIndex', () => {
  const starts = [1, 3, 6, 10];

  it('returns 0 before the first item starts', () => {
    expect(focusedIndex(0.5, starts)).toBe(0);
  });

  it('returns 0 exactly at the first start', () => {
    expect(focusedIndex(1, starts)).toBe(0);
  });

  it('returns the last item whose start has been reached', () => {
    expect(focusedIndex(4, starts)).toBe(1);
    expect(focusedIndex(6, starts)).toBe(2);
    expect(focusedIndex(9.9, starts)).toBe(2);
  });

  it('clamps to the last index once every start has passed', () => {
    expect(focusedIndex(100, starts)).toBe(3);
  });

  it('returns 0 for an empty list', () => {
    expect(focusedIndex(50, [])).toBe(0);
  });
});
