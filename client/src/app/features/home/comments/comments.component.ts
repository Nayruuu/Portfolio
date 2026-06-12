import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { ReviewsService } from '../../../core/services/reviews/reviews.service';
import { ViewportService } from '../../../core/services/viewport/viewport.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { CommentItemComponent } from '../comment/comment.component';
import type { Comment } from '../../../domain';

/** Avatar colour for a visitor-posted review (their initial on a brand-red chip). */
const POSTED_REVIEW_COLOR = '#c1440e';

@Component({
  selector: 'sd-comments',
  styleUrl: './comments.component.scss',
  templateUrl: './comments.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommentItemComponent, IconComponent],
})
export class CommentsComponent {
  protected readonly i18n = inject(I18nService);

  // Collapsed by default on phones (YouTube-app style), expanded on desktop.
  protected readonly expanded = signal(!inject(ViewportService).isCompact());
  protected readonly draft = signal('');

  // Visitor-posted reviews (newest first) prepended to the seeded testimonials.
  protected readonly comments = computed<Comment[]>(() => {
    const content = this.i18n.content();
    const posted = this.reviews.posted().map<Comment>((body) => ({
      who: content.commentYou,
      tag: content.commentYouTag,
      color: POSTED_REVIEW_COLOR,
      when: content.commentJustNow,
      body,
      likes: 0,
    }));

    return [...posted, ...content.comments];
  });

  private readonly reviews = inject(ReviewsService);

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const body = this.draft().trim();

    if (!body) {
      return;
    }
    this.reviews.add(body);
    this.draft.set('');
  }
}
