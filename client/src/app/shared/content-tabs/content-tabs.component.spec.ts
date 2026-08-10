import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContentTabsComponent } from './content-tabs.component';
import { I18nService } from '../../core/services/i18n/i18n.service';

describe('ContentTabsComponent', () => {
  let fixture: ComponentFixture<ContentTabsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ContentTabsComponent] }).compileComponents();
    fixture = TestBed.createComponent(ContentTabsComponent);
    TestBed.inject(I18nService).setLang('fr');
    await fixture.whenStable();
  });

  function tabs(): HTMLAnchorElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('a.ctab'));
  }

  it('renders both segments as real routerLinks to /articles and /series', () => {
    const links = tabs();

    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/fr/articles', '/fr/series']);
  });

  it('labels the segments from the content bridge', () => {
    const content = TestBed.inject(I18nService).content();

    expect(tabs().map((link) => link.textContent?.trim())).toEqual([
      content.contentToggle.articles,
      content.contentToggle.series,
    ]);
  });

  it('prefixes the links with the active language', () => {
    TestBed.inject(I18nService).setLang('en');
    fixture.detectChanges();

    expect(tabs().map((link) => link.getAttribute('href'))).toEqual(['/en/articles', '/en/series']);
  });
});
