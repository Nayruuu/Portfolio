import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { SearchService } from '../../core/services/search/search.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { ARTICLE_FILTER, selectArticles } from '../../core/lib';

@Component({
  selector: 'sd-articles',
  host: { class: 'tab-pane' },
  styleUrl: './articles.component.scss',
  templateUrl: './articles.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
})
export class ArticlesComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly search = inject(SearchService);
  /** Selected filter index (see `ARTICLE_FILTER`) — language-stable. */
  protected readonly selected = signal<number>(ARTICLE_FILTER.ALL);

  /** The tab filter (`selectArticles`) AND the live channel-search query (title / tag / description). */
  protected readonly filtered = computed(() => {
    const content = this.i18n.content();
    const rows = selectArticles(content.articles, this.selected());
    const query = this.search.query().trim().toLowerCase();

    if (!query) {
      return rows;
    }

    return rows.filter(
      ({ article }) =>
        article.title.toLowerCase().includes(query) ||
        article.tag.toLowerCase().includes(query) ||
        article.description.toLowerCase().includes(query),
    );
  });
}
