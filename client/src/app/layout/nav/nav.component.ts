import { ChangeDetectionStrategy, Component, computed, HostListener, inject } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { SearchService } from '../../core/services/search/search.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { PrefsComponent } from '../prefs/prefs.component';

@Component({
  selector: 'sd-nav',
  styleUrl: './nav.component.scss',
  templateUrl: './nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PrefsComponent],
})
export class NavComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly search = inject(SearchService);
  protected readonly content = computed(() => this.i18n.content());

  private readonly router = inject(Router);

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

  /**
   * The keys-hint `/` shortcut focuses the channel search (ignored while already typing in a field).
   * Desktop-only in effect — the nav (and its search) is hidden below `md`.
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
    this.focusInput();
  }
}
