import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import type { Article } from '../../../domain';

/**
 * "Recent articles" sidebar on the home tab — clickable, routes to article detail.
 */
@Component({
  selector: 'sd-up-next',
  styleUrl: './up-next.component.scss',
  templateUrl: './up-next.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
})
export class UpNextComponent {
  protected readonly i18n = inject(I18nService);

  protected readonly recent = computed<Article[]>(() => this.i18n.content().articles.slice(0, 5));

  protected thumbBg(article: Article): string {
    return `radial-gradient(circle at 30% 30%, ${article.accentColor}40, transparent 60%), #0a0a0c`;
  }
}
