import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import type { Comment as DcComment } from '../../../domain';

@Component({
  selector: 'sd-comment',
  templateUrl: './comment.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class CommentItemComponent {
  public readonly data = input.required<DcComment>();

  protected readonly i18n = inject(I18nService);
  protected readonly liked = signal(false);
  protected readonly handle = computed(() => this.data().who.replace(/\s/g, '').toLowerCase());
}
