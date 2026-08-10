import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { THEME, Theme } from '../../../domain';
import { DATA_THEME_ATTR, STORAGE_KEYS } from '../../lib';

/**
 * Theme service — light / dark, persisted to localStorage,
 * applied as `<html data-theme="…">` to drive the CSS overrides.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  public readonly theme = signal<Theme>(this.readInitial());

  private readonly doc = inject(DOCUMENT);

  constructor() {
    effect(() => {
      const currentTheme = this.theme();

      this.doc.documentElement.setAttribute(DATA_THEME_ATTR, currentTheme);
      try {
        localStorage.setItem(STORAGE_KEYS.THEME, currentTheme);
      } catch {
        /* localStorage indisponible */
      }
    });
  }

  public toggle(): void {
    this.theme.update((current) => (current === THEME.LIGHT ? THEME.DARK : THEME.LIGHT));
  }

  public set(next: Theme): void {
    this.theme.set(next);
  }

  private readInitial(): Theme {
    try {
      const storedTheme = localStorage.getItem(STORAGE_KEYS.THEME);

      return storedTheme === THEME.DARK ? THEME.DARK : THEME.LIGHT;
    } catch {
      return THEME.LIGHT;
    }
  }
}
