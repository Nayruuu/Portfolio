import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { articleIdxsForSeries, seriesTotalRead } from '../../core/lib';
import type { Series } from '../../domain';

interface SeriesView extends Series {
  count: number;
  totalRead: string;
}

@Component({
  selector: 'sd-series',
  host: { class: 'tab-pane' },
  styleUrl: './series.component.scss',
  templateUrl: './series.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, RouterLink],
})
export class SeriesComponent {
  protected readonly i18n = inject(I18nService);

  protected readonly seriesList = computed<SeriesView[]>(() => {
    const content = this.i18n.content();

    return content.series.map((series) => {
      const indices = articleIdxsForSeries(content.articles, series.slug);

      return {
        ...series,
        count: indices.length,
        totalRead: seriesTotalRead(content.articles, indices),
      };
    });
  });
}
