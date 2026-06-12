import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, Signal } from '@angular/core';
import { ArticlesComponent } from './articles.component';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { ARTICLE_FILTER } from '../../core/lib';
import { IndexedArticle } from '../../domain';

/** Test view onto the protected members of ArticlesComponent. */
interface ArticlesInternals {
  selected: WritableSignal<number>;
  filtered: Signal<IndexedArticle[]>;
}

// The selection/sort/tag logic is covered exhaustively in `core/lib.spec.ts`.
// Here we only check the component mounts and wires `selected` → `filtered` through that logic.
describe('ArticlesComponent', () => {
  let fixture: ComponentFixture<ArticlesComponent>;
  let component: ArticlesInternals;
  let i18n: I18nService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ArticlesComponent] }).compileComponents();
    fixture = TestBed.createComponent(ArticlesComponent);
    component = fixture.componentInstance as unknown as ArticlesInternals;
    i18n = TestBed.inject(I18nService);
    // Ensure a deterministic locale regardless of localStorage state.
    i18n.setLang('fr');
    await fixture.whenStable();
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  it('defaults to the "All" filter and reacts to `selected`', async () => {
    const all = i18n.content().articles;

    expect(component.selected()).toBe(ARTICLE_FILTER.ALL);
    expect(component.filtered().length).toBe(all.length);

    component.selected.set(ARTICLE_FILTER.RECENT);
    await fixture.whenStable();
    expect(component.filtered().length).toBe(Math.min(6, all.length));
  });
});
