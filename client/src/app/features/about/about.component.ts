import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n/i18n.service';

@Component({
  selector: 'sd-about',
  host: { class: 'tab-pane' },
  styleUrl: './about.component.scss',
  templateUrl: './about.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutComponent {
  protected readonly i18n = inject(I18nService);
}
