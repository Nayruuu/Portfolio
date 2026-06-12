import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ContentStore } from './content.store';
import { FETCH_DELAY_MS } from '../../api/content-api.service';
import { FR } from '../../content/content.fr';
import { EN } from '../../content/content.en';

describe('ContentStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    document.documentElement.removeAttribute('lang');
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('seeds the French content synchronously', () => {
    const store = TestBed.inject(ContentStore);

    expect(store.lang()).toBe('fr');
    expect(store.content()).toBe(FR);
  });

  it('seeds from a persisted "en" preference', () => {
    localStorage.setItem('super-dev-lang', 'en');

    const store = TestBed.inject(ContentStore);

    expect(store.lang()).toBe('en');
    expect(store.content()).toBe(EN);
  });

  it('falls back to "fr" when localStorage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage indisponible');
    });

    expect(TestBed.inject(ContentStore).lang()).toBe('fr');
    spy.mockRestore();
  });

  it('setLang switches the language immediately and flips loading on', () => {
    const store = TestBed.inject(ContentStore);

    store.setLang('en');
    expect(store.lang()).toBe('en');
    expect(store.loading()).toBe(true);
  });

  it('revalidates content to EN after the async fetch resolves', async () => {
    const store = TestBed.inject(ContentStore);

    store.setLang('en');
    const pending = store.reload('en');

    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS);
    await pending;

    expect(store.content()).toBe(EN);
    expect(store.loading()).toBe(false);
  });

  it('discards a stale reload when the language changed meanwhile', async () => {
    const store = TestBed.inject(ContentStore); // lang stays "fr"

    const stale = store.reload('en'); // result for EN, but the store is still on FR

    await vi.advanceTimersByTimeAsync(FETCH_DELAY_MS);
    await stale;

    expect(store.content()).toBe(FR); // EN result discarded (last-wins guard)
  });

  it('persists the language + sets <html lang> via the effect', () => {
    const store = TestBed.inject(ContentStore);

    store.setLang('en');
    TestBed.inject(ApplicationRef).tick();

    expect(localStorage.getItem('super-dev-lang')).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('the persist effect swallows a localStorage write error', () => {
    const store = TestBed.inject(ContentStore);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    store.setLang('en');
    expect(() => TestBed.inject(ApplicationRef).tick()).not.toThrow();
    expect(document.documentElement.lang).toBe('en');
    spy.mockRestore();
  });
});
