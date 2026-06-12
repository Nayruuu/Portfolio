import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CommentsComponent } from './comments.component';

function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
}

describe('CommentsComponent', () => {
  afterEach(() => vi.unstubAllGlobals());

  function commentsHead(fixture: ReturnType<typeof TestBed.createComponent>): HTMLElement {
    return fixture.nativeElement.querySelector('.comments__head') as HTMLElement;
  }

  it('starts collapsed on a phone and expands on toggle', async () => {
    stubMatchMedia(true); // compact viewport
    await TestBed.configureTestingModule({ imports: [CommentsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(CommentsComponent);

    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.comments__input')).toBeNull();
    expect(commentsHead(fixture).getAttribute('aria-expanded')).toBe('false');

    commentsHead(fixture).click();
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.comments__input')).not.toBeNull();
    expect(commentsHead(fixture).getAttribute('aria-expanded')).toBe('true');
  });

  it('starts expanded on desktop', async () => {
    stubMatchMedia(false); // desktop viewport
    await TestBed.configureTestingModule({ imports: [CommentsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(CommentsComponent);

    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.comments__input')).not.toBeNull();
    expect(commentsHead(fixture).getAttribute('aria-expanded')).toBe('true');
  });
});
