import { Injectable, computed, inject, signal } from '@angular/core';
import { PlayerService } from '../player/player.service';

/**
 * Game mode — single source of truth for whether the player frame shows the video
 * (`'video'`) or the BSP game (`'game'`). Defaults to `'video'`, including on the
 * server, so the game canvas never mounts during prerender. Pauses/resumes playback.
 *
 * The BSP game (`sd-bsp-demo`) owns its own level lifecycle, so this service only
 * toggles the mode and hands playback back on exit.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  public readonly mode = signal<'video' | 'game'>('video');
  public readonly running = computed(() => this.mode() === 'game');

  private readonly player = inject(PlayerService);
  private wasPlaying = false;

  public enter(): void {
    this.wasPlaying = this.player.playing();
    this.player.pause();
    this.mode.set('game');
  }

  public exit(): void {
    this.mode.set('video');
    if (this.wasPlaying) {
      this.player.play();
    }
  }
}
