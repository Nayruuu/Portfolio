import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n/i18n.service';

@Component({
  selector: 'sd-stack',
  host: { class: 'tab-pane' },
  styleUrl: './stack.component.scss',
  templateUrl: './stack.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StackComponent {
  protected readonly i18n = inject(I18nService);
}
