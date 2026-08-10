import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { ShareService } from '../../core/services/share/share.service';
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
  protected readonly copied = signal(false);

  protected readonly ascii = `   ┌─────────────────────┐
   │  $ super-dev.app  │
   │  > status: online   │
   │  > role: tech lead  │
   └─────────────────────┘`;

  protected readonly terminal = computed<[string, string][]>(() => [
    ['$ ', 'uptime'],
    ['', this.i18n.content().headerUptime],
    ['$ ', 'stack --top'],
    ['', '  .net  angular  azure  flutter'],
  ]);

  private readonly shareService = inject(ShareService);
  private copiedTimer?: ReturnType<typeof setTimeout>;

  protected async share(): Promise<void> {
    const outcome = await this.shareService.share({
      title: this.content().author,
      text: this.content().bio,
      url: location.href,
    });

    if (outcome === 'copied') {
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
    }
  }
}
