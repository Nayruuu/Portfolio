import { describe, it, expect } from 'vitest';
import { reveal, typed, formatTime } from '.';

describe('reveal', () => {
  it('returns opacity 0 (fade-only, no transform) before `at`', () => {
    // elapsed < at → p = clamp((10 - 20) / 0.5) = 0
    expect(reveal(10, 20)).toEqual({
      opacity: 0,
      transition: 'opacity .35s ease',
      'will-change': 'opacity',
    });
  });

  it('returns ~0.5 opacity at the midpoint of the fade', () => {
    // elapsed = at + dur/2 = 5 + 0.25 → p = (5.25 - 5) / 0.5 = 0.5
    const style = reveal(5.25, 5);

    expect(style.opacity).toBeCloseTo(0.5, 10);
  });

  it('clamps to opacity 1 after `at + dur`', () => {
    // elapsed > at + dur → p clamped to 1
    expect(reveal(100, 20)).toEqual({
      opacity: 1,
      transition: 'opacity .35s ease',
      'will-change': 'opacity',
    });
  });

  it('reaches exactly p=1 at elapsed === at + dur', () => {
    // (5.5 - 5) / 0.5 = 1
    expect(reveal(5.5, 5).opacity).toBe(1);
  });

  it('honours a custom duration', () => {
    // dur = 2, elapsed = at + 1 → p = (3 - 1) / 2 ... use at=1 → (3-1)/2 = 1 → clamp 1
    // pick midpoint: elapsed = 2, at = 1, dur = 2 → (2 - 1) / 2 = 0.5
    expect(reveal(2, 1, 2).opacity).toBeCloseTo(0.5, 10);
  });
});

describe('typed', () => {
  it('returns empty string before `at`', () => {
    expect(typed(1, 2, 'hello world')).toBe('');
  });

  it('returns a partial substring while typing', () => {
    // elapsed - at = 0.1, charsPerSec = 35 → n = floor(0.1 * 35) = floor(3.5) = 3
    expect(typed(2.1, 2, 'hello world')).toBe('hel');
  });

  it('returns the full text once enough time has passed', () => {
    // n = floor((10 - 0) * 35) = 350 >> length → clamped to text.length
    const text = 'hello world';

    expect(typed(10, 0, text)).toBe(text);
  });

  it('returns the full text exactly when n === text.length', () => {
    // text length 5, want n = 5 → (elapsed - at) * cps = 5 → with cps=5, elapsed-at=1
    expect(typed(1, 0, 'abcde', 5)).toBe('abcde');
  });

  it('honours a custom charsPerSec', () => {
    // cps = 10, elapsed - at = 0.45 → n = floor(4.5) = 4
    expect(typed(0.45, 0, 'abcdefgh', 10)).toBe('abcd');
  });

  it('returns empty string at exactly elapsed === at with no progress', () => {
    // n = floor(0 * 35) = 0 → slice(0, 0) = ''
    expect(typed(2, 2, 'hello')).toBe('');
  });
});

describe('formatTime', () => {
  it('formats 0 as 00:00', () => {
    expect(formatTime(0)).toBe('00:00');
  });

  it('formats 59 as 00:59', () => {
    expect(formatTime(59)).toBe('00:59');
  });

  it('formats 60 as 01:00', () => {
    expect(formatTime(60)).toBe('01:00');
  });

  it('formats 3661 as 61:01 (no hour rollover in mm:ss)', () => {
    // m = floor(3661 / 60) = 61, s = floor(3661 % 60) = 1
    expect(formatTime(3661)).toBe('61:01');
  });

  it('floors fractional seconds', () => {
    // m = floor(125.9 / 60) = 2, s = floor(125.9 % 60) = floor(5.9) = 5
    expect(formatTime(125.9)).toBe('02:05');
  });
});
