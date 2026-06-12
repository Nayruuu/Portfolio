import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { ViewportService } from '../../../core/services/viewport/viewport.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { CommentItemComponent } from '../comment/comment.component';

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

  protected toggle(): void {
    this.expanded.update((open) => !open);
  }
}
