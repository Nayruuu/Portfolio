import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { IconComponent } from '../../../shared/icon/icon.component';

/** Base like count the simulated like bar starts from (the +1 is the live up-vote). */
const LIKES_BASE = 248;

@Component({
  selector: 'sd-like-bar',
  templateUrl: './like-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class LikeBarComponent {
  protected readonly likesBase = LIKES_BASE;
  protected readonly i18n = inject(I18nService);
  protected readonly vote = signal<'up' | 'down' | null>(null);
}
