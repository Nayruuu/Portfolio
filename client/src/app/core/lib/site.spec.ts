import { describe, it, expect } from 'vitest';
import {
  AUTHOR,
  DEFAULT_OG_IMAGE,
  OG_LOCALE,
  SITE_NAME,
  SITE_ORIGIN,
  TWIN_LANG,
  absUrl,
  articleDescription,
  twinPath,
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

  it('OG_LOCALE and TWIN_LANG cover both languages', () => {
    expect(OG_LOCALE.fr).toBe('fr_FR');
    expect(OG_LOCALE.en).toBe('en_US');
    expect(TWIN_LANG.fr).toBe('en');
    expect(TWIN_LANG.en).toBe('fr');
  });
});

describe('absUrl', () => {
  it('prefixes the production origin', () => {
    expect(absUrl('/fr/articles/3')).toBe('https://super-dev.app/fr/articles/3');
    expect(absUrl('/')).toBe('https://super-dev.app/');
  });
});

describe('twinPath', () => {
  it('swaps fr → en on a deep path', () => {
    expect(twinPath('/fr/articles/3', 'fr')).toBe('/en/articles/3');
  });

  it('swaps en → fr on a section path', () => {
    expect(twinPath('/en/about', 'en')).toBe('/fr/about');
  });

  it('swaps the bare language root (segment boundary)', () => {
    expect(twinPath('/fr', 'fr')).toBe('/en');
    expect(twinPath('/en', 'en')).toBe('/fr');
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
