import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SITE_NAME, TAB_SEGMENTS } from './core/lib';
import { I18nService } from './core/services/i18n/i18n.service';
import { ThemeService } from './core/services/theme/theme.service';
import { SeoService } from './core/services/seo/seo.service';
import { NavComponent } from './layout/nav/nav.component';
import { ChannelHeaderComponent } from './layout/channel-header/channel-header.component';
import { TabsBarComponent } from './layout/tabs-bar/tabs-bar.component';
import { MiniPlayerComponent } from './features/home/player/mini-player/mini-player.component';
import { PrefsComponent } from './layout/prefs/prefs.component';
import { LANGS, type Content } from './domain';
import type { SeoData } from './core/services/seo/seo.service';

/** Any language home (`/fr`, `/es`, …) and any article-detail route — built from `LANGS`. */
const HOME_RE = new RegExp(`^/(${LANGS.join('|')})/?$`);
const ARTICLE_RE = new RegExp(`^/(${LANGS.join('|')})/articles/[^/]+$`);

/** Series-detail route — captures the slug for its per-series title/description. */
const SERIES_RE = new RegExp(`^/(${LANGS.join('|')})/series/([^/]+)$`);

@Component({
  selector: 'sd-app',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    NavComponent,
    ChannelHeaderComponent,
    TabsBarComponent,
    MiniPlayerComponent,
    PrefsComponent,
  ],
})
export class AppComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly themeService = inject(ThemeService);
  /** Home only — the fist-shortcut hint (`k`/`j`/`l`) is wired to the player, which lives here. */
  protected readonly isHome = signal(false);

  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);

  constructor() {
    // Baseline SEO for non-article routes (article-detail sets its own per-article
    // SEO + JSON-LD). Runs on every navigation, server-side too → captured by SSG.
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => {
        const url = event.urlAfterRedirects;
        const isHomeUrl = HOME_RE.test(url);

        this.isHome.set(isHomeUrl);

        if (ARTICLE_RE.test(url)) {
          return;
        }

        if (isHomeUrl) {
          this.seo.setSiteJsonLd(this.i18n.lang());
        } else {
          this.seo.clearJsonLd();
        }
        this.seo.update({
          ...this.seoFor(url, this.i18n.content()),
          path: url,
          lang: this.i18n.lang(),
          type: 'website',
        });
      });
  }

  /** Per-route title/description: series detail > tab label > brand + metaTitle (home, fallback). */
  private seoFor(url: string, content: Content): Pick<SeoData, 'title' | 'description'> {
    const series = content.series.find((entry) => entry.slug === url.match(SERIES_RE)?.[2]);

    if (series) {
      return { title: `${series.title} — ${SITE_NAME}`, description: series.description };
    }
    const tabIndex = TAB_SEGMENTS.indexOf(url.split('/')[2] ?? '');

    if (tabIndex > 0) {
      return {
        title: `${content.tabs[tabIndex]} — ${SITE_NAME}`,
        description: content.tabDescriptions[tabIndex],
      };
    }

    return {
      title: `${SITE_NAME} — ${content.metaTitle}`,
      description: tabIndex === 0 ? content.tabDescriptions[0] : content.bio,
    };
  }
}
