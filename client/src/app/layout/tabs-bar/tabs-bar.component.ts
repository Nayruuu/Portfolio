import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { TAB_SEGMENTS } from '../../core/lib';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { IconName } from '../../shared/icon/icon-set';

/** Section icon for the mobile bottom bar, same order as `TAB_SEGMENTS`. */
const TAB_ICONS: readonly IconName[] = ['home', 'articles', 'projects', 'about', 'layers', 'mail'];

@Component({
  selector: 'sd-tabs-bar',
  templateUrl: './tabs-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent],
})
export class TabsBarComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly content = computed(() => this.i18n.content());
  protected readonly icons = TAB_ICONS;
  protected readonly segments = TAB_SEGMENTS;

  /** Language-aware links: `/fr`, `/fr/articles`, … for the current language. */
  protected readonly links = computed(() => {
    const lang = this.i18n.lang();

    return TAB_SEGMENTS.map((segment) => (segment ? ['/', lang, segment] : ['/', lang]));
  });

  /** Séries lives "under" the Articles tab (route-backed toggle), so /series must light Articles too. */
  protected readonly onSeries = computed(() => this.currentSegment() === 'series');

  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  /** The first path segment after the language prefix (`/fr/series/x` → `series`). */
  private readonly currentSegment = computed(() => this.url().split('/')[2] ?? '');
}
