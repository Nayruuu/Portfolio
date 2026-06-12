import { describe, expect, it } from 'vitest';
import { DEFAULT_LANG, isLang, LANG, LANGS } from './lang';

describe('LANG', () => {
  it('exposes the supported language values', () => {
    expect(LANG.FR).toBe('fr');
    expect(LANG.EN).toBe('en');
    expect(LANG.ES).toBe('es');
    expect(LANG.DE).toBe('de');
  });

  it('LANGS lists every value with the default first', () => {
    expect(LANGS).toEqual(['fr', 'en', 'es', 'de']);
    expect(DEFAULT_LANG).toBe('fr');
    expect(LANGS[0]).toBe(DEFAULT_LANG);
  });

  it('isLang narrows supported values and rejects everything else', () => {
    expect(isLang('fr')).toBe(true);
    expect(isLang('de')).toBe(true);
    expect(isLang('ru')).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });
});
