import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService } from '../../../../core/services/i18n/i18n.service';
import { PlayerService } from '../../../../core/services/player/player.service';
import { IconComponent } from '../../../../shared/icon/icon.component';
import { PlayerStageComponent } from '../player-stage/player-stage.component';

/**
 * Floating mini-player (picture-in-picture) — rendered at the app shell so it stays visible while you
 * scroll or navigate away from the home player. It reuses `sd-player-stage` (same live scenes) and the
 * shared `PlayerService` state, with a minimal play/pause + restore control bar.
 */
@Component({
  selector: 'sd-mini-player',
  styleUrl: './mini-player.component.scss',
  templateUrl: './mini-player.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PlayerStageComponent],
})
export class MiniPlayerComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly player = inject(PlayerService);

  protected readonly progressPercent = computed(
    () => (this.player.time() / this.player.totalSec()) * 100,
  );

  /** Click-to-seek on the mini progress bar (mirrors the main player). */
  protected seek(event: MouseEvent, bar: HTMLElement): void {
    const rect = bar.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;

    this.player.seek(fraction * this.player.totalSec());
  }
}
