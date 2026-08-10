import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { ShareService } from '../../../core/services/share/share.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { articleIdxsForSeries, formatArticleDate, seriesTotalRead } from '../../../core/lib';
import type { Article } from '../../../domain';

@Component({
  selector: 'sd-series-detail',
  host: { class: 'tab-pane' },
  styleUrl: './series-detail.component.scss',
  templateUrl: './series-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
})
export class SeriesDetailComponent {
  protected readonly i18n = inject(I18nService);

  /** Route param `:slug`, bound via withComponentInputBinding. */
  protected readonly slug = input.required<string>();
  protected readonly seriesIndex = computed(() =>
    this.i18n.content().series.findIndex((series) => series.slug === this.slug()),
  );

  protected readonly series = computed(() => {
    const allSeries = this.i18n.content().series;

    return allSeries[this.seriesIndex()] ?? allSeries[0];
  });

  protected readonly articles = computed<{ article: Article; index: number }[]>(() => {
    const allArticles = this.i18n.content().articles;

    return articleIdxsForSeries(allArticles, this.slug()).map((index) => ({
      article: allArticles[index],
      index,
    }));
  });

  protected readonly totalRead = computed(() =>
    seriesTotalRead(
      this.i18n.content().articles,
      this.articles().map(({ index }) => index),
    ),
  );
  protected readonly copied = signal(false);

  private readonly shareService = inject(ShareService);
  private copiedTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

    effect(() => {
      this.seriesIndex();
      if (!isBrowser) {
        return;
      }
      queueMicrotask(() => {
        const element = document.querySelector('.series-detail') as HTMLElement | null;

        if (!element) {
          return;
        }
        const navHeight =
          (document.querySelector('.nav') as HTMLElement | null)?.offsetHeight ?? 56;
        const top = element.getBoundingClientRect().top + window.scrollY - navHeight - 8;

        window.scrollTo({ top, behavior: 'smooth' });
      });
    });
  }

  protected async share(): Promise<void> {
    const series = this.series();
    const outcome = await this.shareService.share({
      title: series.title,
      text: series.description,
      url: location.href,
    });

    if (outcome === 'copied') {
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
    }
  }

  protected pad(value: number): string {
    return String(value).padStart(2, '0');
  }

  protected dateOf(article: Article): string {
    return formatArticleDate(article.date, this.i18n.lang());
  }
}
