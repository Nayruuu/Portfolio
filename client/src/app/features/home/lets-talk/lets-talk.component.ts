import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import type { ContactMethod } from '../../../domain';

@Component({
  selector: 'sd-lets-talk',
  styleUrl: './lets-talk.component.scss',
  templateUrl: './lets-talk.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, IconComponent],
})
export class LetsTalkComponent {
  protected readonly i18n = inject(I18nService);

  /** LinkedIn + GitHub, straight from the contact channels (single data source). */
  protected readonly profiles = computed(() =>
    this.i18n
      .content()
      .contact.altMethods.filter(
        (method) => method.kind === 'linkedin' || method.kind === 'github',
      ),
  );

  protected linkOf(method: ContactMethod): string {
    return `https://${method.label}`;
  }
}
