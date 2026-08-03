import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { IconComponent } from '../../../shared/icon/icon.component';

@Component({
  selector: 'sd-like-bar',
  templateUrl: './like-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class LikeBarComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly vote = signal<'up' | 'down' | null>(null);
}
