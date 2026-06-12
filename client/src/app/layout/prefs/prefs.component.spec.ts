import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { PrefsComponent } from './prefs.component';
import { ThemeService } from '../../core/services/theme/theme.service';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { LANGS, type Lang } from '../../domain';

/** Test view onto the protected members of PrefsComponent. */
interface PrefsInternals {
  langOpen: WritableSignal<boolean>;
  switchLang(lang: Lang): void;
  toggleLang(): void;
  closeLangOnOutsideClick(event: Event): void;
  closeLang(): void;
}

/** Make the router's read-only `url` getter return a fixed path, and stub `navigate`. */
function stubRouter(router: Router, url: string): ReturnType<typeof vi.fn> {
  const navigate = vi.fn().mockResolvedValue(true);

  router.navigate = navigate as unknown as Router['navigate'];
  Object.defineProperty(router, 'url', { get: () => url, configurable: true });

  return navigate;
}

describe('PrefsComponent', () => {
  let fixture: ComponentFixture<PrefsComponent>;
  let component: PrefsInternals;
  let router: Router;
  let theme: ThemeService;
  let i18n: I18nService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PrefsComponent] }).compileComponents();
    fixture = TestBed.createComponent(PrefsComponent);
    component = fixture.componentInstance as unknown as PrefsInternals;
    router = TestBed.inject(Router);
    theme = TestBed.inject(ThemeService);
    i18n = TestBed.inject(I18nService);
    i18n.setLang('fr');
    await fixture.whenStable();
  });

  it('mounts and the language toggle shows the current language', async () => {
    await fixture.whenStable();
    const toggle = fixture.nativeElement.querySelector('.prefs__lang-toggle') as HTMLButtonElement;

    expect(toggle.textContent?.trim()).toContain('FR');
  });

  it('the theme button toggles the theme service', async () => {
    const before = theme.theme();

    (fixture.nativeElement.querySelector('.prefs__icon-btn') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(theme.theme()).not.toBe(before);
  });

  it('opening the picker lists every language, the current one active', async () => {
    expect(fixture.nativeElement.querySelector('.prefs__lang-menu')).toBeNull();

    (fixture.nativeElement.querySelector('.prefs__lang-toggle') as HTMLButtonElement).click();
    await fixture.whenStable();

    const items = fixture.nativeElement.querySelectorAll('.prefs__lang-item');

    expect(items.length).toBe(LANGS.length);
    expect(
      fixture.nativeElement.querySelector('.prefs__lang-item.is-active')?.textContent?.trim(),
    ).toBe('FR');
  });

  it('picking a language navigates to the twin URL and closes the menu', () => {
    const navigate = stubRouter(router, '/fr/articles');

    component.toggleLang();
    component.switchLang('en');

    expect(navigate).toHaveBeenCalledWith(['/', 'en', 'articles']);
    expect(component.langOpen()).toBe(false);
  });

  it('switching from the bare root pushes the language as the first segment', () => {
    const navigate = stubRouter(router, '/');

    component.switchLang('de');

    expect(navigate).toHaveBeenCalledWith(['/', 'de']);
  });

  it('an outside click closes the menu; an inside click leaves it open', () => {
    component.langOpen.set(true);
    component.closeLangOnOutsideClick({ target: document.body } as unknown as Event);
    expect(component.langOpen()).toBe(false);

    const inside = document.createElement('div');

    inside.className = 'prefs__lang';
    component.langOpen.set(true);
    component.closeLangOnOutsideClick({ target: inside } as unknown as Event);
    expect(component.langOpen()).toBe(true);
  });

  it('Escape closes the menu', () => {
    component.langOpen.set(true);
    component.closeLang();
    expect(component.langOpen()).toBe(false);
  });
});
