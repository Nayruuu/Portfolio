import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'sd-channel-header',
  styleUrl: './channel-header.component.scss',
  templateUrl: './channel-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class ChannelHeaderComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly content = computed(() => this.i18n.content());
  protected readonly subscribed = signal(false);

  protected readonly ascii = `   ┌─────────────────────┐
   │  $ super-dev.app  │
   │  > status: online   │
   │  > role: full-stack │
   └─────────────────────┘`;

  protected readonly terminal = computed<[string, string][]>(() => [
    ['$ ', 'uptime'],
    ['', this.i18n.content().headerUptime],
    ['$ ', 'stack --top'],
    ['', '  .net  angular  azure  flutter'],
  ]);
}
