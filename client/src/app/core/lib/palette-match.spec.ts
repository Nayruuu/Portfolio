import { describe, expect, it } from 'vitest';
import { paletteMatch } from './palette-match';

describe('paletteMatch', () => {
  it('matches everything on an empty query', () => {
    expect(paletteMatch('anything at all', '')).toBe(true);
  });

  it('matches a contiguous substring', () => {
    expect(paletteMatch('Angular 21 in practice', 'angular')).toBe(true);
  });

  it('matches a non-contiguous subsequence (chars in order)', () => {
    expect(paletteMatch('Return To Office', 'rto')).toBe(true);
  });

  it('rejects when a character is missing', () => {
    expect(paletteMatch('Articles', 'xyz')).toBe(false);
  });

  it('rejects when the characters are present but out of order', () => {
    expect(paletteMatch('abc', 'cba')).toBe(false);
  });

  it('is case-insensitive both ways', () => {
    expect(paletteMatch('CONTACT', 'con')).toBe(true);
    expect(paletteMatch('contact', 'CON')).toBe(true);
  });

  it('matches accented characters literally (case-insensitive)', () => {
    expect(paletteMatch('Séries', 'séri')).toBe(true);
    expect(paletteMatch('SÉRIES', 'séri')).toBe(true);
  });
});
