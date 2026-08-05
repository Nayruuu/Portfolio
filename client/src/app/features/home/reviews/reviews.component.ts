import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import type { Review } from '../../../domain';

@Component({
  selector: 'sd-reviews',
  styleUrl: './reviews.component.scss',
  templateUrl: './reviews.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class ReviewsComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly expanded = signal(false);

  protected initialOf(review: Review): string {
    return review.who.charAt(0);
  }
}
