import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { PROJECTS, SITE_NAME, TAB_SEGMENTS, type ProjectMeta } from './core/lib';
import { I18nService } from './core/services/i18n/i18n.service';
import { ThemeService } from './core/services/theme/theme.service';
import { SeoService } from './core/services/seo/seo.service';
import { NavComponent } from './layout/nav/nav.component';
import { ChannelHeaderComponent } from './layout/channel-header/channel-header.component';
import { TabsBarComponent } from './layout/tabs-bar/tabs-bar.component';
import { MiniPlayerComponent } from './features/home/player/mini-player/mini-player.component';
import { PrefsComponent } from './layout/prefs/prefs.component';
import { CommandPaletteComponent } from './shared/command-palette/command-palette.component';
import { LANGS, type Content } from './domain';
import type { SeoData } from './core/services/seo/seo.service';

/** Any language home (`/fr`, `/es`, …) and any article-detail route — built from `LANGS`. */
const HOME_RE = new RegExp(`^/(${LANGS.join('|')})/?$`);
const ARTICLE_RE = new RegExp(`^/(${LANGS.join('|')})/articles/[^/]+$`);

/** Series-detail route — captures the slug for its per-series title/description. */
const SERIES_RE = new RegExp(`^/(${LANGS.join('|')})/series/([^/]+)$`);

/** Series LIST route — no longer a top-level tab (it lives under Articles), so it needs its own SEO. */
const SERIES_LIST_RE = new RegExp(`^/(${LANGS.join('|')})/series/?$`);

/** The about route — promoted to a canonical named-entity page (ProfilePage + Person). */
const ABOUT_RE = new RegExp(`^/(${LANGS.join('|')})/about/?$`);

/** The projects list, and a project-detail route (its slug drives the SoftwareSourceCode JSON-LD). */
const PROJECTS_RE = new RegExp(`^/(${LANGS.join('|')})/projects/?$`);
const PROJECT_DETAIL_RE = new RegExp(`^/(${LANGS.join('|')})/projects/([^/]+)$`);

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
    CommandPaletteComponent,
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
        } else if (ABOUT_RE.test(url)) {
          this.seo.setProfileJsonLd(this.i18n.lang(), url);
        } else if (PROJECT_DETAIL_RE.test(url)) {
          this.setProjectDetailSeo(url);
        } else if (PROJECTS_RE.test(url)) {
          this.setProjectsListSeo(url);
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
    // About is the ProfilePage: name-first, but the "À propos" label differentiates it from the home
    // title (which now owns `{author} — {role}`), so the two entity pages never share one title.
    if (ABOUT_RE.test(url)) {
      const aboutLabel = content.tabs[TAB_SEGMENTS.indexOf('about')];

      return { title: `${content.author} — ${aboutLabel}`, description: content.bio };
    }
    const projectSlug = url.match(PROJECT_DETAIL_RE)?.[2];

    if (projectSlug) {
      const project = content.projectScenes.find((scene) => scene.slug === projectSlug);

      if (project) {
        return { title: `${project.name} — ${SITE_NAME}`, description: project.description };
      }
    }
    if (PROJECTS_RE.test(url)) {
      return {
        title: `${content.projectsUi.title} — ${SITE_NAME}`,
        description: content.projectsUi.subtitle,
      };
    }
    // Séries dropped its tab (now reached via the Articles toggle) but stays a real, indexable page.
    if (SERIES_LIST_RE.test(url)) {
      return {
        title: `${content.contentToggle.series} — ${SITE_NAME}`,
        description: content.seriesUi.subtitle,
      };
    }
    const tabIndex = TAB_SEGMENTS.indexOf(url.split('/')[2] ?? '');

    if (tabIndex > 0) {
      return {
        title: `${content.tabs[tabIndex]} — ${SITE_NAME}`,
        description: content.tabDescriptions[tabIndex],
      };
    }

    // Home leads with the NAME (not the brand) — for a "Stéphane De Todaro" query the strongest page
    // (the one external profiles link to) must present the person first. Tab pages keep the brand suffix.
    return {
      title: `${content.author} — ${content.metaTitle}`,
      description: tabIndex === 0 ? content.tabDescriptions[0] : content.bio,
    };
  }

  /** SoftwareSourceCode JSON-LD for a project detail page — authored by the canonical Person. */
  private setProjectDetailSeo(url: string): void {
    const slug = url.match(PROJECT_DETAIL_RE)?.[2] ?? '';
    const content = this.i18n.content();
    const project = content.projectScenes.find((scene) => scene.slug === slug);
    const meta: ProjectMeta | undefined = PROJECTS[slug as keyof typeof PROJECTS];

    if (!project || !meta) {
      this.seo.clearJsonLd();

      return;
    }
    const lang = this.i18n.lang();
    const sameAs = [meta.nuget, meta.docs, meta.live].filter((link): link is string =>
      Boolean(link),
    );

    this.seo.setProjectJsonLd(
      {
        name: project.name,
        description: project.description,
        stack: project.stack,
        repo: meta.repo,
        programmingLanguage: meta.programmingLanguage,
        license: meta.license,
        sameAs,
        path: url,
        lang,
      },
      [
        { name: content.projectsUi.title, path: `/${lang}/projects` },
        { name: project.name, path: url },
      ],
    );
  }

  /** CollectionPage (ItemList) JSON-LD for the projects list — the project index. */
  private setProjectsListSeo(url: string): void {
    const content = this.i18n.content();
    const lang = this.i18n.lang();
    const items = content.projectScenes
      .filter((scene) => scene.slug)
      .map((scene) => ({ name: scene.name, path: `/${lang}/projects/${scene.slug}` }));

    this.seo.setProjectsJsonLd(lang, url, items);
  }
}
