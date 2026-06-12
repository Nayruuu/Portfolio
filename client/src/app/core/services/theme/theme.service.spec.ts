import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({});
  });

  it('defaults to light', () => {
    expect(TestBed.inject(ThemeService).theme()).toBe('light');
  });

  it('readInitial: restores "dark" from localStorage', () => {
    localStorage.setItem('super-dev-theme', 'dark');
    expect(TestBed.inject(ThemeService).theme()).toBe('dark');
  });

  it('toggle switches both ways and applies data-theme', () => {
    const svc = TestBed.inject(ThemeService);

    svc.toggle(); // light → dark
    TestBed.inject(ApplicationRef).tick();
    expect(svc.theme()).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');

    svc.toggle(); // dark → light (opposite ternary branch)
    TestBed.inject(ApplicationRef).tick();
    expect(svc.theme()).toBe('light');
    expect(document.documentElement.dataset['theme']).toBe('light');
  });

  it('persists the theme', () => {
    const svc = TestBed.inject(ThemeService);

    svc.set('dark');
    TestBed.inject(ApplicationRef).tick();
    expect(localStorage.getItem('super-dev-theme')).toBe('dark');
  });

  it('readInitial: falls back to "light" if localStorage is unavailable (private mode)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('localStorage indisponible');
    });

    expect(TestBed.inject(ThemeService).theme()).toBe('light');
    spy.mockRestore();
  });
});
