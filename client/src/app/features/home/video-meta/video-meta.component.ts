import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { PlayerService } from '../../../core/services/player/player.service';
import { IconComponent } from '../../../shared/icon/icon.component';
import { LikeBarComponent } from '../like-bar/like-bar.component';

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

  protected readonly tagLine = computed(() =>
    this.i18n
      .content()
      .featuredTags.map((tag) => '#' + tag)
      .join(' '),
  );
}
