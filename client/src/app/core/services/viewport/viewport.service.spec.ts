import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ViewportService } from './viewport.service';

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

describe('ViewportService', () => {
  beforeEach(() => TestBed.configureTestingModule({}));
  afterEach(() => vi.unstubAllGlobals());

  it('isCompact is true below the md breakpoint', () => {
    stubMatchMedia(true);
    expect(TestBed.inject(ViewportService).isCompact()).toBe(true);
  });

  it('isCompact is false at desktop widths', () => {
    stubMatchMedia(false);
    expect(TestBed.inject(ViewportService).isCompact()).toBe(false);
  });

  it('reacts to media-query changes after mount', () => {
    let onChange: (event: MediaQueryListEvent) => void = () => undefined;

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: (_: string, handler: (event: MediaQueryListEvent) => void) =>
          (onChange = handler),
        removeEventListener: vi.fn(),
      }),
    );
    const service = TestBed.inject(ViewportService);

    expect(service.isCompact()).toBe(false);
    onChange({ matches: true } as MediaQueryListEvent);
    expect(service.isCompact()).toBe(true);
  });

  it('subscribes to and unsubscribes from the media query', () => {
    const add = vi.fn();
    const remove = vi.fn();

    vi.stubGlobal(
      'matchMedia',
      vi
        .fn()
        .mockReturnValue({ matches: false, addEventListener: add, removeEventListener: remove }),
    );
    const service = TestBed.inject(ViewportService);

    expect(add).toHaveBeenCalledOnce();
    TestBed.resetTestingModule(); // triggers DestroyRef cleanup
    expect(remove).toHaveBeenCalledOnce();
    expect(service).toBeTruthy();
  });

  it('stays false on the server and never touches matchMedia', () => {
    const matchMedia = vi.fn();

    vi.stubGlobal('matchMedia', matchMedia);
    TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });

    expect(TestBed.inject(ViewportService).isCompact()).toBe(false);
    expect(matchMedia).not.toHaveBeenCalled();
  });
});
