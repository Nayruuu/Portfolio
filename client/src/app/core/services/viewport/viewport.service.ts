import { DestroyRef, Injectable, PLATFORM_ID, Signal, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Viewport service — exposes a single reactive flag for "are we below the `md`
 * breakpoint (≤ 899.98px)". SSR/prerender-safe: defaults to `false` on the server
 * (no `matchMedia`), updates from the media query in the browser. Used by the nav
 * (drawer disclosure ARIA) and the home comments section (start collapsed on phones).
 */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  public readonly isCompact: Signal<boolean>;

  private readonly compact = signal(false);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.isCompact = this.compact.asReadonly();

    if (isPlatformBrowser(this.platformId)) {
      const query = window.matchMedia('(max-width: 899.98px)');
      const onChange = (event: MediaQueryListEvent): void => this.compact.set(event.matches);

      this.compact.set(query.matches);
      query.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }
  }
}
