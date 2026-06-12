import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { SearchService } from '../../core/services/search/search.service';
import { ThemeService } from '../../core/services/theme/theme.service';
import { ViewportService } from '../../core/services/viewport/viewport.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { Lang } from '../../domain';

@Component({
  selector: 'sd-nav',
  styleUrl: './nav.component.scss',
  templateUrl: './nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class NavComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly theme = inject(ThemeService);
  protected readonly search = inject(SearchService);
  protected readonly content = computed(() => this.i18n.content());
  /** Mobile drawer state — collapses search + actions behind the ☰ menu button. */
  protected readonly menuOpen = signal(false);
  /**
   * True only below the `md` breakpoint, where the ☰ truly toggles the drawer. On desktop
   * `.nav__collapsible` is `display: contents` (its content is permanently visible), so the
   * disclosure ARIA on the ☰ would mislead — we gate `aria-expanded`/`aria-controls` on this.
   * SSR/prerender-safe: `ViewportService` defaults to `false` on the server (no misleading
   * attribute in static HTML).
   */
  protected readonly isCompact = inject(ViewportService).isCompact;
  private readonly router = inject(Router);

  /** Language toggle = navigate to the twin URL (same path, other language). */
  protected switchLang(lang: Lang): void {
    const segments = this.router.url.split(/[?#]/)[0].split('/').filter(Boolean);

    if (segments.length === 0) {
      segments.push(lang);
    } else {
      segments[0] = lang;
    }
    this.router.navigate(['/', ...segments]);
    this.closeMenu();
  }

  protected focusInput(): void {
    (document.querySelector('.nav__search-input') as HTMLInputElement | null)?.focus();
  }

  /**
   * Live channel search: update the shared query (the articles grid filters off it) and, from any
   * other screen, route to the articles list so the results are visible as you type.
   */
  protected onSearch(value: string): void {
    this.search.query.set(value);

    const onArticlesList = this.router.url.split(/[?#]/)[0].endsWith('/articles');

    if (value && !onArticlesList) {
      this.router.navigate(['/', this.i18n.lang(), 'articles']);
    }
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  /** Escape closes the drawer (standard disclosure keyboard pattern); no-op when already closed. */
  @HostListener('document:keydown.escape')
  protected handleEscape(): void {
    if (this.menuOpen()) {
      this.closeMenu();
    }
  }

  /**
   * The keys-hint `/` shortcut focuses the channel search (ignored while already typing in a
   * field). On compact viewports the search lives behind the ☰ drawer, so open it first.
   */
  @HostListener('document:keydown', ['$event'])
  protected handleSearchShortcut(event: KeyboardEvent): void {
    const target = event.target;

    if (
      event.key !== '/' ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      (target instanceof Element && target.closest('input, textarea, select, [contenteditable]'))
    ) {
      return;
    }
    event.preventDefault();
    if (this.isCompact()) {
      this.menuOpen.set(true);
    }
    this.focusInput();
  }
}
