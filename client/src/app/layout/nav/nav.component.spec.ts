import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavComponent } from './nav.component';

describe('NavComponent', () => {
  let fixture: ComponentFixture<NavComponent>;

  beforeEach(async () => {
    // jsdom (the unit-test DOM) doesn't implement matchMedia, which `ViewportService` reads on
    // the browser platform to drive `isCompact`. Stub a desktop-width MediaQueryList so the
    // component mounts; the SSR/prerender path is exercised by the build, not here.
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList;

    await TestBed.configureTestingModule({ imports: [NavComponent] }).compileComponents();
    fixture = TestBed.createComponent(NavComponent);
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });
});
