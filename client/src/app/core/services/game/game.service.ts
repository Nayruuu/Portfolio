import { Injectable, computed, inject, signal } from '@angular/core';
import { buildLevel, type Level } from '../../lib';
import { PlayerService } from '../player/player.service';

const SEED_RANGE = 2 ** 31;

/** A fresh random run seed — the ONLY randomness; the generator is a pure function of it. */
function randomSeed(): number {
  return Math.floor(Math.random() * SEED_RANGE);
}

/**
 * Game mode — single source of truth for whether the player frame shows the video
 * (`'video'`) or the raycaster game (`'game'`). Defaults to `'video'`, including on the
 * server, so the game canvas never mounts during prerender. Pauses/resumes playback.
 */
@Injectable({ providedIn: 'root' })
export class GameService {
  public readonly mode = signal<'video' | 'game'>('video');
  public readonly running = computed(() => this.mode() === 'game');

  /** Index of the active level; advanced forever by the exit switch, reset to 0 on enter()/death. */
  public readonly levelIndex = signal(0);
  /** The active level: the hand-authored campaign level for `levelIndex` (a pure function of it; the run seed
   *  is ignored for a bespoke map), falling through to the procedural "Endless" assembler past the campaign.
   *  The theme cycles per index and the same `(seed, index)` replays a byte-identical `Level`;
   *  `advanceLevel()` bumps `levelIndex` to walk the campaign then on into the endless rooms. */
  public readonly level = computed<Level>(() => buildLevel(this.runSeed(), this.levelIndex()));

  private readonly player = inject(PlayerService);
  private readonly runSeed = signal(randomSeed());
  private wasPlaying = false;

  /** Advance to the next (freshly generated) level — endless. */
  public advanceLevel(): void {
    this.levelIndex.set(this.levelIndex() + 1);
  }

  /** Restart the whole run with a new seed at level 0 (used on player death). */
  public resetRun(): void {
    this.runSeed.set(randomSeed());
    this.levelIndex.set(0);
  }

  public enter(): void {
    this.wasPlaying = this.player.playing();
    this.player.pause();
    this.runSeed.set(randomSeed());
    this.levelIndex.set(0);
    this.mode.set('game');
  }

  public exit(): void {
    this.mode.set('video');
    if (this.wasPlaying) {
      this.player.play();
    }
  }
}
