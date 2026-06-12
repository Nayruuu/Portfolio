import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { I18nService } from './i18n.service';
import { FETCH_DELAY_MS } from '../../api/content-api.service';
import { FR } from '../../content/content.fr';
import { EN } from '../../content/content.en';

describe('I18nService (facade over ContentStore)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('defaults to French with the content seeded synchronously', () => {
    const svc = TestBed.inject(I18nService);

    expect(svc.lang()).toBe('fr');
    expect(svc.content()).toBe(FR);
  });

  it('setLang switches the language immediately and the content after revalidation', async () => {
    const svc = TestBed.inject(I18nService);

    svc.setLang('en');
    expect(svc.lang()).toBe('en');

    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS);
    expect(svc.content()).toBe(EN);
  });

  it('persists the language in localStorage and on <html lang> (effect)', () => {
    const svc = TestBed.inject(I18nService);

    svc.setLang('en');
    TestBed.inject(ApplicationRef).tick();

    expect(localStorage.getItem('super-dev-lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('falls back to "fr" if localStorage is unavailable (private mode)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage indisponible');
    });

    expect(TestBed.inject(I18nService).lang()).toBe('fr');
    spy.mockRestore();
  });
});
