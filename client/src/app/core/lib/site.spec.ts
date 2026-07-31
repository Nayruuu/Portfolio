import { describe, it, expect } from 'vitest';
import {
  AUTHOR,
  DEFAULT_OG_IMAGE,
  OG_LOCALE,
  SITE_NAME,
  SITE_ORIGIN,
  SOCIAL_URLS,
  absUrl,
  pathInLang,
} from '.';

describe('site constants', () => {
  it('origin / name / image standardize on super-dev.app', () => {
    expect(SITE_ORIGIN).toBe('https://super-dev.app');
    expect(SITE_NAME).toBe('super-dev.app');
    expect(DEFAULT_OG_IMAGE).toBe('https://super-dev.app/og-default.png');
    expect(AUTHOR.url).toBe(SITE_ORIGIN);
    expect(AUTHOR.name.length).toBeGreaterThan(0);
    expect(SOCIAL_URLS.every((url) => url.startsWith('https://'))).toBe(true);
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
