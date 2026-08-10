import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
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
import { LikeBarComponent } from '../../../shared/like-bar/like-bar.component';
import {
  articleDescription,
  articleIdxsForSeries,
  articleOgImage,
  buildToc,
  formatArticleDate,
  parseMarkdown,
  seriesIdxForArticle,
  tocEntries,
} from '../../../core/lib';
import { ARTICLE_BODIES } from '../../../core/content/article-bodies';
import { SeoService } from '../../../core/services/seo/seo.service';
import { ShareService } from '../../../core/services/share/share.service';
import type { Article, ArticleBlock } from '../../../domain';

@Component({
  selector: 'sd-article-detail',
  host: { class: 'tab-pane' },
  styleUrl: './article-detail.component.scss',
  templateUrl: './article-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, CodeBlockComponent, InlineRunsComponent, LikeBarComponent, RouterLink],
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
  /** Table of contents (h2/h3) for the sticky rail — empty below 2 headings. */
  protected readonly toc = computed(() => buildToc(this.body()));
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
  protected readonly copied = signal(false);
  /** Id of the heading currently under the scroll-spy band — highlights its TOC entry. */
  protected readonly activeId = signal('');

  private readonly seo = inject(SeoService);
  private readonly shareService = inject(ShareService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /**
   * Deduped id per heading block, keyed by block reference — the single source shared by the
   * heading `[id]`, its permalink anchor, the TOC link and the scroll-spy target. Aligned by
   * document order with {@link tocEntries}, so every id matches its TOC entry exactly.
   */
  private readonly headingIds = computed(() => {
    const ids = new Map<ArticleBlock, string>();
    const entries = tocEntries(this.body());
    let index = 0;

    for (const block of this.body()) {
      if (block.type === 'h2' || block.type === 'h3') {
        ids.set(block, entries[index++].id);
      }
    }

    return ids;
  });
  /** Headings currently inside the scroll-spy band; the topmost drives `activeId`. */
  private readonly intersecting = new Set<Element>();
  private copiedTimer?: ReturnType<typeof setTimeout>;
  private observer?: IntersectionObserver;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

    if (isBrowser) {
      const onScroll = () => {
        const maxScroll = document.body.scrollHeight - window.innerHeight;

        this.progress.set(maxScroll > 0 ? Math.min(1, window.scrollY / maxScroll) : 0);
      };

      window.addEventListener('scroll', onScroll, { passive: true });
      destroyRef.onDestroy(() => window.removeEventListener('scroll', onScroll));

      // Scroll-spy: highlight the topmost heading sitting in the top band. The observer is born
      // after the first render (browser only), then re-points at the headings whenever the
      // article — and thus the rendered body — changes.
      afterNextRender(() => {
        this.observer = new IntersectionObserver((entries) => this.onIntersect(entries), {
          rootMargin: '-80px 0px -80% 0px',
        });
        this.observeHeadings();
      });
      effect(() => {
        this.toc(); // track: re-observe the new headings on article change

        queueMicrotask(() => this.observeHeadings());
      });
      destroyRef.onDestroy(() => this.observer?.disconnect());
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
        image: articleOgImage(article.slug, lang),
        type: 'article',
      });
      const tabs = this.i18n.content().tabs;

      this.seo.setArticleJsonLd(
        {
          title: article.title,
          description,
          path,
          lang,
          image: articleOgImage(article.slug, lang),
          type: 'article',
          // Single publish date per article (showcase data); modified mirrors published until/unless a separate field is needed.
          datePublished: article.date,
          dateModified: article.date,
        },
        // tabs[0]/tabs[1] = the localized Home / Articles labels (order = TAB_SEGMENTS).
        [
          { name: tabs[0], path: `/${lang}` },
          { name: tabs[1], path: `/${lang}/articles` },
          { name: article.title, path },
        ],
      );
    });

    destroyRef.onDestroy(() => this.seo.clearJsonLd());
  }

  protected async share(): Promise<void> {
    const article = this.article();
    const outcome = await this.shareService.share({
      title: article.title,
      text: articleDescription(article),
      url: location.href,
    });

    if (outcome === 'copied') {
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
    }
  }

  /** TOC / heading-permalink click — scroll there ourselves (the router resets scroll to the top otherwise). */
  protected scrollToHeading(id: string, event: Event): void {
    event.preventDefault();
    const target = document.getElementById(id);

    if (target !== null) {
      target.scrollIntoView({ behavior: 'smooth' });
      history.replaceState(null, '', `#${id}`);
    }
  }

  protected dateOf(article: Article): string {
    return formatArticleDate(article.date, this.i18n.lang());
  }

  protected heroBg(article: Article): string {
    return `radial-gradient(circle at 30% 30%, ${article.accentColor}60, transparent 70%), #0a0a0c`;
  }

  /** Deduped id for a heading block — shared with its TOC entry and scroll-spy target. */
  protected headingId(block: ArticleBlock): string {
    return this.headingIds().get(block) ?? '';
  }

  /** Track the band's members, then highlight the topmost — or clear when the band is empty. */
  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        this.intersecting.add(entry.target);
      } else {
        this.intersecting.delete(entry.target);
      }
    }

    let topmost: Element | undefined;
    let topY = Infinity;

    for (const heading of this.intersecting) {
      const y = heading.getBoundingClientRect().top;

      if (y < topY) {
        topY = y;
        topmost = heading;
      }
    }
    this.activeId.set(topmost?.id ?? '');
  }

  private observeHeadings(): void {
    const observer = this.observer;

    if (!observer) {
      return;
    }
    observer.disconnect();
    this.intersecting.clear();
    this.activeId.set('');
    const headings = this.host.nativeElement.querySelectorAll<HTMLElement>(
      '.article-detail__body h2[id], .article-detail__body h3[id]',
    );

    headings.forEach((heading) => observer.observe(heading));
  }
}
