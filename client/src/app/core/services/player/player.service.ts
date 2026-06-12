import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Chapter } from '../../../domain';
import { I18nService } from '../i18n/i18n.service';

/**
 * Player service — holds playback time and play/pause state.
 * Single source of truth for the player + chapter list, so any
 * component (description chapter list, easter-egg toaster, etc.)
 * can subscribe via signals.
 */
@Injectable({ providedIn: 'root' })
export class PlayerService {
  public readonly time = signal(0);
  public readonly playing = signal(true);

  /** Playback speed (0.5×–2×) — scales the tick increment, like a video player's speed menu. */
  public readonly rate = signal(1);

  /** Mini-player (picture-in-picture) — the player detaches into a floating bottom-right frame that
   *  persists across navigation (the service is the single source of truth, rendered at the shell). */
  public readonly mini = signal(false);

  /** Reactive view of chapters (depends on language). */
  public readonly chapters = computed<Chapter[]>(() => this.i18n.content().chapters);
  public readonly totalSec = computed(() => this.i18n.content().totalSec);

  /** Currently active chapter based on time. */
  public readonly currentChapter = computed<Chapter>(() => {
    const currentTime = this.time();
    const chapterList = this.chapters();
    let activeChapter = chapterList[0];

    for (const chapter of chapterList) {
      if (currentTime >= chapter.seconds) {
        activeChapter = chapter;
      }
    }

    return activeChapter;
  });

  /** Elapsed time inside the current chapter — used for progressive reveal. */
  public readonly chapterElapsed = computed(() => this.time() - this.currentChapter().seconds);

  private readonly i18n = inject(I18nService);
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Drive the tick loop reactively from `playing`.
    effect((onCleanup) => {
      if (!this.playing()) {
        return;
      }
      const intervalId = setInterval(() => {
        const next = this.time() + 0.1 * this.rate();

        this.time.set(next >= this.totalSec() ? 0 : next);
      }, 100);

      onCleanup(() => clearInterval(intervalId));
    });
  }

  public togglePlay(): void {
    this.playing.update((current) => !current);
  }

  public play(): void {
    this.playing.set(true);
  }

  public pause(): void {
    this.playing.set(false);
  }

  public seek(seconds: number): void {
    this.time.set(Math.max(0, Math.min(this.totalSec(), seconds)));
  }

  public setRate(rate: number): void {
    this.rate.set(rate);
  }

  public toggleMini(): void {
    this.mini.update((on) => !on);
  }

  public closeMini(): void {
    this.mini.set(false);
  }

  public nextChapter(): void {
    const chapterList = this.chapters();
    const currentChapterId = this.currentChapter().id;
    const currentIndex = chapterList.findIndex((chapter) => chapter.id === currentChapterId);
    const next = chapterList[(currentIndex + 1) % chapterList.length];

    this.seek(next.seconds);
  }
}
