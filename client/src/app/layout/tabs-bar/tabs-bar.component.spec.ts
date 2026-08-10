import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TabsBarComponent } from './tabs-bar.component';
import { I18nService } from '../../core/services/i18n/i18n.service';

describe('TabsBarComponent', () => {
  let fixture: ComponentFixture<TabsBarComponent>;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TabsBarComponent] }).compileComponents();
    router = TestBed.inject(Router);
    router.resetConfig([
      { path: 'fr/articles', children: [] },
      { path: 'fr/series', children: [] },
      { path: 'fr/projects', children: [] },
    ]);
    TestBed.inject(I18nService).setLang('fr');
    fixture = TestBed.createComponent(TabsBarComponent);
    await fixture.whenStable();
  });

  function tabs(): HTMLAnchorElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('a.tab'));
  }

  function labels(): (string | undefined)[] {
    return tabs().map((tab) => tab.querySelector('.tab__label')?.textContent?.trim());
  }

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  it('shows Réalisations in place of Séries (six tabs, Séries removed)', () => {
    expect(labels()).toEqual([
      'Accueil',
      'Articles',
      'Réalisations',
      'À propos',
      'Stack',
      'Contact',
    ]);
  });

  it('lights the Réalisations tab on /projects', async () => {
    await router.navigateByUrl('/fr/projects');
    await fixture.whenStable();

    const selected = tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true');

    expect(selected.map((tab) => tab.querySelector('.tab__label')?.textContent?.trim())).toEqual([
      'Réalisations',
    ]);
  });

  it('lights the Articles tab on /series (séries lives under Articles)', async () => {
    await router.navigateByUrl('/fr/series');
    await fixture.whenStable();

    const selected = tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true');

    expect(selected.map((tab) => tab.querySelector('.tab__label')?.textContent?.trim())).toEqual([
      'Articles',
    ]);
  });
});
