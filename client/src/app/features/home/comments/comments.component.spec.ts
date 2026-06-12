import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  function commentsHead(fixture: ReturnType<typeof TestBed.createComponent>): HTMLElement {
    return fixture.nativeElement.querySelector('.comments__head') as HTMLElement;
  }

  async function expandedDesktop(): Promise<ReturnType<typeof TestBed.createComponent>> {
    stubMatchMedia(false); // desktop viewport → expanded
    await TestBed.configureTestingModule({ imports: [CommentsComponent] }).compileComponents();
    const fixture = TestBed.createComponent(CommentsComponent);

    await fixture.whenStable();

    return fixture;
  }

  function type(fixture: ReturnType<typeof TestBed.createComponent>, value: string): void {
    const field = fixture.nativeElement.querySelector('.comments__input-field') as HTMLInputElement;

    field.value = value;
    field.dispatchEvent(new Event('input'));
    TestBed.inject(ApplicationRef).tick();
  }

  function submit(fixture: ReturnType<typeof TestBed.createComponent>): void {
    (fixture.nativeElement.querySelector('.comments__input') as HTMLFormElement).dispatchEvent(
      new Event('submit', { cancelable: true }),
    );
    TestBed.inject(ApplicationRef).tick();
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
    const fixture = await expandedDesktop();

    expect(fixture.nativeElement.querySelector('.comments__input')).not.toBeNull();
    expect(commentsHead(fixture).getAttribute('aria-expanded')).toBe('true');
  });

  it('reveals the send button only once the field holds text', async () => {
    const fixture = await expandedDesktop();

    expect(fixture.nativeElement.querySelector('.comments__input-send')).toBeNull();

    type(fixture, 'Clean architecture.');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.comments__input-send')).not.toBeNull();
  });

  it('posts a review: it appears on top and clears the field', async () => {
    const fixture = await expandedDesktop();
    const seeded = fixture.nativeElement.querySelectorAll('sd-comment').length;

    type(fixture, 'Clean architecture, great review.');
    submit(fixture);
    await fixture.whenStable();

    const comments = fixture.nativeElement.querySelectorAll('sd-comment');
    const field = fixture.nativeElement.querySelector('.comments__input-field') as HTMLInputElement;

    expect(comments.length).toBe(seeded + 1);
    expect((comments[0] as HTMLElement).querySelector('.comment__body')?.textContent).toContain(
      'Clean architecture, great review.',
    );
    expect(field.value).toBe('');
    expect(fixture.nativeElement.querySelector('.comments__input-send')).toBeNull();
  });

  it('ignores a blank submission', async () => {
    const fixture = await expandedDesktop();
    const seeded = fixture.nativeElement.querySelectorAll('sd-comment').length;

    type(fixture, '   ');
    submit(fixture);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelectorAll('sd-comment').length).toBe(seeded);
  });
});
