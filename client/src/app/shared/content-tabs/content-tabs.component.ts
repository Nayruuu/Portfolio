import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { I18nService } from '../../core/services/i18n/i18n.service';

/**
 * Route-backed Articles | Séries toggle shown atop both list pages. Each segment is a real
 * `routerLink` to a prerendered, indexable route — séries is never collapsed to client-only state,
 * so both pages stay in the sitemap and the active segment reflects the current URL.
 */
@Component({
  selector: 'sd-content-tabs',
  styleUrl: './content-tabs.component.scss',
  templateUrl: './content-tabs.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
})
export class ContentTabsComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly labels = computed(() => this.i18n.content().contentToggle);

  /** Language-aware links to the two real routes (`/fr/articles`, `/fr/series`). */
  protected readonly links = computed(() => {
    const lang = this.i18n.lang();

    return { articles: ['/', lang, 'articles'], series: ['/', lang, 'series'] };
  });
}
