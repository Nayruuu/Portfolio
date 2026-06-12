import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { I18nService } from './core/services/i18n/i18n.service';
import { ThemeService } from './core/services/theme/theme.service';
import { SeoService } from './core/services/seo/seo.service';
import { NavComponent } from './layout/nav/nav.component';
import { ChannelHeaderComponent } from './layout/channel-header/channel-header.component';
import { TabsBarComponent } from './layout/tabs-bar/tabs-bar.component';
import { MiniPlayerComponent } from './features/home/player/mini-player/mini-player.component';
import { PrefsComponent } from './layout/prefs/prefs.component';
import { LANGS } from './domain';

/** Any language home (`/fr`, `/es`, …) and any article-detail route — built from `LANGS`. */
const HOME_RE = new RegExp(`^/(${LANGS.join('|')})/?$`);
const ARTICLE_RE = new RegExp(`^/(${LANGS.join('|')})/articles/[^/]+$`);

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

        this.isHome.set(HOME_RE.test(url));

        if (ARTICLE_RE.test(url)) {
          return;
        }

        const content = this.i18n.content();

        this.seo.clearJsonLd();
        this.seo.update({
          title: `super-dev.app — ${content.bio.slice(0, 48)}`,
          description: content.bio,
          path: url,
          lang: this.i18n.lang(),
          type: 'website',
        });
      });
  }
}
