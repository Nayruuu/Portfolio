import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { CodeBlockComponent } from '../../../shared/code-block/code-block.component';
import { InlineRunsComponent } from '../../../shared/inline-runs/inline-runs.component';
import {
  DEFAULT_OG_IMAGE,
  articleDescription,
  articleIdxsForSeries,
  parseMarkdown,
  seriesIdxForArticle,
} from '../../../core/lib';
import { ARTICLE_BODIES } from '../../../core/content/article-bodies';
import { SeoService } from '../../../core/services/seo/seo.service';
import type { Article } from '../../../domain';

@Component({
  selector: 'sd-article-detail',
  host: { class: 'tab-pane' },
  styleUrl: './article-detail.component.scss',
  templateUrl: './article-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, CodeBlockComponent, InlineRunsComponent, RouterLink],
})
export class ArticleDetailComponent {
  protected readonly i18n = inject(I18nService);

  /** Route param `:slug`, bound via withComponentInputBinding. */
  protected readonly slug = input.required<string>();
  protected readonly articleIndex = computed(() =>
    this.i18n.content().articles.findIndex((article) => article.slug === this.slug()),
  );

  protected readonly article = computed<Article>(() => {
    const articles = this.i18n.content().articles;

    return articles[this.articleIndex()] ?? articles[0];
  });
  protected readonly body = computed(() =>
    parseMarkdown(ARTICLE_BODIES[this.article().slug]?.[this.i18n.lang()] ?? ''),
  );
  protected readonly seriesIndex = computed(() =>
    seriesIdxForArticle(this.i18n.content().series, this.article()),
  );
  protected readonly seriesArticleIdxs = computed(() =>
    articleIdxsForSeries(this.i18n.content().articles, this.article().series ?? ''),
  );

  protected readonly suggested = computed(() => {
    const articles = this.i18n.content().articles;
    const tag = this.article().tag;
    const currentIndex = this.articleIndex();

    return articles
      .map((article, index) => ({ article, index }))
      .filter(({ article, index }) => index !== currentIndex && article.tag === tag)
      .slice(0, 3);
  });

  protected readonly progress = signal(0);

  private readonly seo = inject(SeoService);

  constructor() {
    const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

    if (isBrowser) {
      const onScroll = () => {
        const maxScroll = document.body.scrollHeight - window.innerHeight;

        this.progress.set(maxScroll > 0 ? Math.min(1, window.scrollY / maxScroll) : 0);
      };

      window.addEventListener('scroll', onScroll, { passive: true });
      inject(DestroyRef).onDestroy(() => window.removeEventListener('scroll', onScroll));
    }

    // Scroll the topbar just below the sticky nav whenever the article changes (browser only).
    effect(() => {
      this.articleIndex(); // track
      if (!isBrowser) {
        return;
      }
      queueMicrotask(() => {
        const element = document.querySelector('.article-detail') as HTMLElement | null;

        if (!element) {
          return;
        }
        const navHeight =
          (document.querySelector('.nav') as HTMLElement | null)?.offsetHeight ?? 56;
        const top = element.getBoundingClientRect().top + window.scrollY - navHeight - 8;

        window.scrollTo({ top, behavior: 'smooth' });
      });
    });

    // Drive SEO + JSON-LD reactively from the current article (lang-aware).
    effect(() => {
      const article = this.article();
      const lang = this.i18n.lang();
      const path = `/${lang}/articles/${article.slug}`;
      const description = articleDescription(article);

      this.seo.update({
        title: `${article.title} — super-dev.app`,
        description,
        path,
        lang,
        image: DEFAULT_OG_IMAGE,
        type: 'article',
      });
      this.seo.setArticleJsonLd({
        title: article.title,
        description,
        path,
        lang,
        image: DEFAULT_OG_IMAGE,
        type: 'article',
        // Single publish date per article (showcase data); modified mirrors published until/unless a separate field is needed.
        datePublished: article.date,
        dateModified: article.date,
      });
    });

    inject(DestroyRef).onDestroy(() => this.seo.clearJsonLd());
  }

  protected heroBg(article: Article): string {
    return `radial-gradient(circle at 30% 30%, ${article.accentColor}60, transparent 70%), #0a0a0c`;
  }
}
