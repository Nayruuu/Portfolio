import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { CommandPaletteComponent } from './command-palette.component';
import { PaletteService } from '../../core/services/palette/palette.service';
import { SearchService } from '../../core/services/search/search.service';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { ThemeService } from '../../core/services/theme/theme.service';
import type { Content } from '../../domain';

const CONTENT = {
  search: 'rechercher',
  tabs: ['Accueil', 'Articles', 'Réalisations', 'À propos', 'Stack', 'Contact'],
  articles: [
    {
      slug: 'moteur-doom',
      title: 'Moteur DOOM',
      tag: 'ANGULAR',
      description: 'un moteur',
      symbol: '❖',
      accentColor: '#b4451c',
    },
    {
      slug: 'azure-pipelines',
      title: 'Azure Pipelines',
      tag: 'AZURE',
      description: 'ci cd',
      symbol: '⟳',
      accentColor: '#1c7ab4',
    },
  ],
  series: [
    {
      slug: 'net-moderne',
      title: '.NET moderne',
      description: 'la série .NET',
      colors: ['#7c4dff'],
      symbol: '◆',
    },
  ],
  projectScenes: [
    { slug: 'open-space-exe', name: 'OPEN SPACE.EXE', role: 'moteur' },
    { slug: undefined, name: 'Sans page', role: 'x' },
    { slug: 'pas-un-projet', name: 'Fantôme', role: 'y' },
  ],
  palette: {
    title: 'Palette de commandes',
    placeholder: 'Rechercher une page, un article, une action…',
    pages: 'Aller à',
    articles: 'Articles',
    series: 'Séries',
    projects: 'Projets',
    actions: 'Actions',
    themeAction: 'Basculer le thème',
    langAction: 'Changer de langue',
    copyLink: 'Copier le lien de la page',
    seeAll: 'Voir tous les résultats',
    empty: 'Aucun résultat',
    navHint: 'naviguer',
    runHint: 'ouvrir',
    closeHint: 'fermer',
  },
} as unknown as Content;

interface Internals {
  onInput: (value: string) => void;
  selected: () => number;
}

describe('CommandPaletteComponent', () => {
  let fixture: ComponentFixture<CommandPaletteComponent>;
  let palette: PaletteService;
  let navigate: ReturnType<typeof vi.fn>;
  let navigateByUrl: ReturnType<typeof vi.fn>;
  let toggle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    navigate = vi.fn();
    navigateByUrl = vi.fn();
    toggle = vi.fn();
    TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
      providers: [
        { provide: I18nService, useValue: { content: signal(CONTENT), lang: signal('fr') } },
        { provide: ThemeService, useValue: { theme: signal('light'), toggle } },
        { provide: Router, useValue: { url: '/fr', navigate, navigateByUrl } },
      ],
    });
    palette = TestBed.inject(PaletteService);
    fixture = TestBed.createComponent(CommandPaletteComponent);
    fixture.detectChanges();
  });

  function internals(): Internals {
    return fixture.componentInstance as unknown as Internals;
  }

  function rows(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.cmdk__row'));
  }

  function keydown(init: KeyboardEventInit): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    fixture.detectChanges();
  }

  it('renders nothing while closed and the dialog once opened', () => {
    expect(fixture.nativeElement.querySelector('.cmdk')).toBeNull();

    palette.show();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    expect(rows().length).toBeGreaterThan(0);
  });

  it('filters the results as the query narrows', () => {
    palette.show();
    fixture.detectChanges();
    internals().onInput('Azure');
    fixture.detectChanges();

    const labels = rows().map((row) => row.textContent ?? '');

    expect(labels.some((text) => text.includes('Azure Pipelines'))).toBe(true);
    expect(labels.some((text) => text.includes('Moteur DOOM'))).toBe(false);
    expect(labels.some((text) => text.includes('.NET moderne'))).toBe(false);
  });

  it('shows the empty state, and no "see all results" row, when nothing matches', () => {
    palette.show();
    fixture.detectChanges();
    internals().onInput('zzzzzz');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cmdk__empty')).not.toBeNull();
    expect(rows().some((row) => (row.textContent ?? '').includes('Voir tous les résultats'))).toBe(
      false,
    );
  });

  it('moves the selection with arrows and runs it on Enter', () => {
    palette.show();
    fixture.detectChanges();

    keydown({ key: 'ArrowDown' });
    expect(internals().selected()).toBe(1);

    keydown({ key: 'Enter' });
    expect(navigate).toHaveBeenCalledWith(['/', 'fr', 'articles']);
  });

  it('closes on Escape', () => {
    palette.show();
    fixture.detectChanges();

    keydown({ key: 'Escape' });

    expect(palette.open()).toBe(false);
  });

  it('opens on the "/" shortcut', () => {
    keydown({ key: '/' });

    expect(palette.open()).toBe(true);
  });

  it('ignores "/" while typing in a field', () => {
    const field = document.createElement('input');

    document.body.appendChild(field);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    fixture.detectChanges();

    expect(palette.open()).toBe(false);
    field.remove();
  });

  it('toggles on ⌘K / Ctrl+K', () => {
    keydown({ key: 'k', metaKey: true });
    expect(palette.open()).toBe(true);

    keydown({ key: 'k', metaKey: true });
    expect(palette.open()).toBe(false);
  });

  it('runs the theme action', () => {
    palette.show();
    fixture.detectChanges();
    internals().onInput('thème');
    fixture.detectChanges();

    const themeRow = rows().find((row) => (row.textContent ?? '').includes('Basculer le thème'));

    themeRow?.click();

    expect(toggle).toHaveBeenCalled();
    expect(palette.open()).toBe(false);
  });

  it('routes to the full articles grid via "see all results", seeding the grid filter', () => {
    const search = TestBed.inject(SearchService);

    palette.show();
    fixture.detectChanges();
    internals().onInput('Azure');
    fixture.detectChanges();

    const seeAll = rows().find((row) =>
      (row.textContent ?? '').includes('Voir tous les résultats'),
    );

    seeAll?.click();

    expect(search.query()).toBe('Azure');
    expect(navigate).toHaveBeenCalledWith(['/', 'fr', 'articles']);
  });

  it('cycles to the next locale, routing to the same path via navigateByUrl', () => {
    palette.show();
    fixture.detectChanges();
    internals().onInput('langue');
    fixture.detectChanges();

    rows()
      .find((row) => (row.textContent ?? '').includes('Changer de langue'))
      ?.click();

    expect(navigateByUrl).toHaveBeenCalledWith('/en');
  });

  it('copies the page link to the clipboard', () => {
    const writeText = vi.fn();

    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    palette.show();
    fixture.detectChanges();
    internals().onInput('Copier');
    fixture.detectChanges();

    rows()
      .find((row) => (row.textContent ?? '').includes('Copier le lien'))
      ?.click();

    expect(writeText).toHaveBeenCalledWith(location.href);
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it('never lists the hidden game — the engine project routes to /projects, never /bsp', () => {
    palette.show();
    fixture.detectChanges();

    expect((fixture.nativeElement.textContent ?? '').toLowerCase()).not.toContain('bsp');

    const projectRow = rows().find((row) => (row.textContent ?? '').includes('OPEN SPACE.EXE'));

    projectRow?.click();

    expect(navigate).toHaveBeenCalledWith(['/', 'fr', 'projects', 'open-space-exe']);
    expect(navigate).not.toHaveBeenCalledWith(expect.arrayContaining(['bsp']));
  });

  it('traps Tab focus inside the dialog (wraps last→first and first→last)', () => {
    palette.show();
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);

    const focusable = Array.from(
      fixture.nativeElement.querySelectorAll('input, button'),
    ) as HTMLElement[];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    keydown({ key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    keydown({ key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fixture.nativeElement.remove();
  });
});
