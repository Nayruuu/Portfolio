import { describe, expect, it } from 'vitest';
import { slugify } from './slugify';

describe('slugify', () => {
  it('lowercases and joins words with dashes', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('strips accents down to ASCII', () => {
    expect(slugify('Créer une résolution')).toBe('creer-une-resolution');
  });

  it('collapses runs of non-alphanumerics into a single dash', () => {
    expect(slugify('C#  &  .NET')).toBe('c-net');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('  — Intro —  ')).toBe('intro');
  });

  it('keeps digits', () => {
    expect(slugify('Angular 21 signals')).toBe('angular-21-signals');
  });

  it('returns an empty string when nothing alphanumeric survives', () => {
    expect(slugify('### — ###')).toBe('');
  });
});
