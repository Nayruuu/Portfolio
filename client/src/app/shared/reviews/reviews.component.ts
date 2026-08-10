import { ChangeDetectionStrategy, Component, inject, input, linkedSignal } from '@angular/core';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { IconComponent } from '../icon/icon.component';
import type { Review } from '../../domain';

@Component({
  selector: 'sd-reviews',
  styleUrl: './reviews.component.scss',
  templateUrl: './reviews.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class ReviewsComponent {
  /** Seeds the initial state: home stays collapsed (default), /about shows the recos open. */
  public readonly startExpanded = input(false);

  protected readonly i18n = inject(I18nService);
  // linkedSignal (not signal(startExpanded())) so the input seeds it once bound, yet it stays writable for the toggle.
  protected readonly expanded = linkedSignal(() => this.startExpanded());

  protected initialOf(review: Review): string {
    return review.who.charAt(0);
  }
}
