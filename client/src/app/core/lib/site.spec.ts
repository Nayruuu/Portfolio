import { describe, it, expect } from 'vitest';
import {
  AUTHOR,
  DEFAULT_OG_IMAGE,
  OG_LOCALE,
  SITE_NAME,
  SITE_ORIGIN,
  absUrl,
  articleDescription,
  pathInLang,
} from '.';
import type { Article } from '../../domain';

const art = (over: Partial<Article> = {}): Article => ({
  slug: 'title',
  tag: '.NET',
  title: 'Title',
  reads: '1k',
  ago: '1d',
  readTime: '5 min',
  accentColor: '#fff',
  symbol: 'x',
  date: '2026-01-01',
  description: 'd',
  ...over,
});

describe('site constants', () => {
  it('origin / name / image standardize on super-dev.app', () => {
    expect(SITE_ORIGIN).toBe('https://super-dev.app');
    expect(SITE_NAME).toBe('super-dev.app');
    expect(DEFAULT_OG_IMAGE).toBe('https://super-dev.app/og-default.png');
    expect(AUTHOR.url).toBe(SITE_ORIGIN);
    expect(AUTHOR.name.length).toBeGreaterThan(0);
  });

  it('OG_LOCALE covers every supported language', () => {
    expect(OG_LOCALE.fr).toBe('fr_FR');
    expect(OG_LOCALE.en).toBe('en_US');
    expect(OG_LOCALE.es).toBe('es_ES');
    expect(OG_LOCALE.de).toBe('de_DE');
  });
});

describe('absUrl', () => {
  it('prefixes the production origin', () => {
    expect(absUrl('/fr/articles/3')).toBe('https://super-dev.app/fr/articles/3');
    expect(absUrl('/')).toBe('https://super-dev.app/');
  });
});

describe('pathInLang', () => {
  it('swaps the language prefix on a deep path', () => {
    expect(pathInLang('/fr/articles/3', 'es')).toBe('/es/articles/3');
  });

  it('swaps the prefix on a section path', () => {
    expect(pathInLang('/en/about', 'de')).toBe('/de/about');
  });

  it('swaps the bare language root (segment boundary)', () => {
    expect(pathInLang('/fr', 'en')).toBe('/en');
    expect(pathInLang('/de/stack', 'fr')).toBe('/fr/stack');
  });
});

describe('articleDescription', () => {
  it('returns the base when under the cap', () => {
    expect(articleDescription(art({ tag: '.NET', title: 'Short', readTime: '5 min' }))).toBe(
      '.NET · Short · 5 min',
    );
  });

  it('strips the "$ " shell prefix from the title', () => {
    expect(
      articleDescription(art({ tag: '.NET', title: '$ deploy.azure()', readTime: '8 min' })),
    ).toBe('.NET · deploy.azure() · 8 min');
  });

  it('truncates with an ellipsis when over the cap', () => {
    const description = articleDescription(art({ title: 'A'.repeat(300) }), 50);

    expect(description.length).toBeLessThanOrEqual(50);
    expect(description.endsWith('…')).toBe(true);
  });
});
