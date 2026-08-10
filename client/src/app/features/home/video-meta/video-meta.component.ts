import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { PlayerService } from '../../../core/services/player/player.service';
import { ShareService } from '../../../core/services/share/share.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { LikeBarComponent } from '../../../shared/like-bar/like-bar.component';

@Component({
  selector: 'sd-video-meta',
  styleUrl: './video-meta.component.scss',
  templateUrl: './video-meta.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, LikeBarComponent],
})
export class VideoMetaComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly player = inject(PlayerService);
  protected readonly copied = signal(false);

  protected readonly tagLine = computed(() =>
    this.i18n
      .content()
      .featuredTags.map((tag) => '#' + tag)
      .join(' '),
  );

  private readonly shareService = inject(ShareService);
  private copiedTimer?: ReturnType<typeof setTimeout>;

  protected async share(): Promise<void> {
    const content = this.i18n.content();
    const outcome = await this.shareService.share({
      title: content.author,
      text: content.bio,
      url: location.href,
    });

    if (outcome === 'copied') {
      this.copied.set(true);
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
    }
  }
}
