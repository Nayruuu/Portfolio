import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OG_IMAGE,
  OG_LOCALE,
  PERSON,
  PERSON_ID,
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
    expect(SOCIAL_URLS.every((url) => url.startsWith('https://'))).toBe(true);
  });

  it('PERSON is the one canonical entity (stable @id, name, alternateName, sameAs)', () => {
    expect(PERSON['@id']).toBe(PERSON_ID);
    expect(PERSON_ID).toBe(`${SITE_ORIGIN}/#stephane`);
    expect(PERSON['@type']).toBe('Person');
    expect(PERSON.url).toBe(SITE_ORIGIN);
    expect(PERSON.name.length).toBeGreaterThan(0);
    expect(PERSON.alternateName).toBe('Nayruuu');
    expect(PERSON.sameAs).toEqual([...SOCIAL_URLS]);
    expect(PERSON.jobTitle.length).toBeGreaterThan(0);
  });

  it('OG_LOCALE covers every supported language', () => {
    expect(OG_LOCALE.fr).toBe('fr_FR');
    expect(OG_LOCALE.en).toBe('en_US');
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
    expect(pathInLang('/fr/articles/3', 'en')).toBe('/en/articles/3');
  });

  it('swaps the prefix on a section path', () => {
    expect(pathInLang('/en/about', 'fr')).toBe('/fr/about');
  });

  it('swaps the bare language root (segment boundary)', () => {
    expect(pathInLang('/fr', 'en')).toBe('/en');
    expect(pathInLang('/en/stack', 'fr')).toBe('/fr/stack');
  });
});
