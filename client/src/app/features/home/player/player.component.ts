import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  PLATFORM_ID,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { PlayerService } from '../../../core/services/player/player.service';
import { GameService } from '../../../core/services/game/game.service';
import { formatTime } from '../../../core/lib';
import { IconComponent } from '../../../shared/icon/icon.component';
import { PlayerStageComponent } from './player-stage/player-stage.component';
import { BspDemoComponent } from '../../bsp-demo/bsp-demo.component';

/**
 * `ScreenOrientation.lock()` is no longer in the TS DOM lib (Android-only in practice) —
 * a narrow structural view of `screen.orientation`, instead of `any`.
 */
interface OrientationLock {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
}

/**
 * Video player — wraps the dark cinema frame.
 * Each scene gets its own component and is driven by signals from PlayerService.
 */
@Component({
  selector: 'sd-player',
  styleUrl: './player.component.scss',
  templateUrl: './player.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PlayerStageComponent, BspDemoComponent],
})
export class PlayerComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly player = inject(PlayerService);
  protected readonly game = inject(GameService);

  protected readonly idle = signal(false);

  /** Speed menu (the ⚙️ gear) — playback rates offered, and whether the popover is open. */
  protected readonly speeds = [0.5, 1, 1.5, 2];
  protected readonly settingsOpen = signal(false);

  /**
   * Fullscreen state — single source of truth for both paths: the native path syncs it
   * from `fullscreenchange` (covers Esc / system exits), the iOS CSS fallback toggles it
   * directly. All fullscreen styling hangs off the resulting `is-fullscreen` class.
   */
  protected readonly fullscreen = signal(false);
  protected readonly hoverPct = signal<number | null>(null);
  protected readonly hoverChapter = computed(() => {
    const fraction = this.hoverPct();

    if (fraction === null) {
      return null;
    }
    const chapters = this.player.chapters();
    const seconds = fraction * this.player.totalSec();
    let currentChapter = chapters[0];

    for (const chapter of chapters) {
      if (seconds >= chapter.seconds) {
        currentChapter = chapter;
      }
    }

    return currentChapter;
  });

  protected readonly progressPercent = computed(
    () => (this.player.time() / this.player.totalSec()) * 100,
  );

  /** Chapter ticks (all but the first) — memoized so the timeline @for keeps a
   *  stable array reference across the 100 ms playback ticks. */
  protected readonly tickChapters = computed(() => this.player.chapters().slice(1));

  protected readonly format = formatTime;

  /**
   * Native Fullscreen API availability — `false` on the server and on iOS Safari (no
   * `Element.requestFullscreen()` on a simulated `<div>` player), which selects the
   * CSS-fallback path.
   */
  protected readonly nativeFullscreen =
    isPlatformBrowser(inject(PLATFORM_ID)) && Boolean(document.fullscreenEnabled);

  private readonly progressEl = viewChild<ElementRef<HTMLDivElement>>('progress');

  private readonly playerBox = viewChild.required<ElementRef<HTMLDivElement>>('playerBox');

  private readonly destroyRef = inject(DestroyRef);

  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Initial idle timer — cleared on destroy so a pending tick can't touch a dead component.
    this.wake();
    this.destroyRef.onDestroy(() => {
      if (this.idleTimer) {
        clearTimeout(this.idleTimer);
      }
    });

    if (this.nativeFullscreen) {
      const onChange = (): void => {
        const isFullscreen = document.fullscreenElement !== null;

        this.fullscreen.set(isFullscreen);
        if (!isFullscreen) {
          this.unlockOrientation();
        }
      };

      document.addEventListener('fullscreenchange', onChange);
      this.destroyRef.onDestroy(() => document.removeEventListener('fullscreenchange', onChange));
    }
  }

  protected wake(): void {
    this.idle.set(false);
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }
    this.idleTimer = setTimeout(() => this.idle.set(true), 4500);
  }

  protected onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    if (
      this.game.running() ||
      target.closest('.player__controls') ||
      target.closest('.player__live') ||
      target.closest('.player__quality')
    ) {
      return;
    }
    this.settingsOpen.set(false);
    this.player.togglePlay();
  }

  protected toggleSettings(): void {
    this.settingsOpen.update((open) => !open);
  }

  protected setRate(rate: number): void {
    this.player.setRate(rate);
    this.settingsOpen.set(false);
  }

  protected onProgressClick(event: MouseEvent): void {
    const element = this.progressEl()?.nativeElement;

    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;

    this.player.seek(fraction * this.player.totalSec());
  }

  protected onProgressHover(event: MouseEvent): void {
    const element = this.progressEl()?.nativeElement;

    if (!element) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));

    this.hoverPct.set(fraction);
  }

  protected enterGame(): void {
    // The game fills the screen via its own non-rotated overlay (`.player:has(sd-bsp-demo)`, mobile) —
    // NOT the player's CSS-fallback fullscreen, whose 90° rotation breaks the game's touch coordinates.
    this.game.enter();
  }

  protected exitGame(): void {
    this.game.exit();
  }

  protected toggleFullscreen(): void {
    // Exit (either path): native exits via the API (the signal syncs on `fullscreenchange`); the
    // CSS-fallback clears the signal directly.
    if (this.fullscreen()) {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        this.fullscreen.set(false);
      }

      return;
    }
    // Enter: prefer the native API, but **fall back to the CSS fullscreen** if it's unavailable or the
    // browser rejects the request (some contexts block `requestFullscreen`) — so the button always works.
    if (this.nativeFullscreen) {
      void this.playerBox()
        .nativeElement.requestFullscreen()
        .then(() => this.lockOrientation()) // success → the signal syncs on `fullscreenchange`
        .catch(() => this.fullscreen.set(true)); // rejected → CSS fallback
    } else {
      this.fullscreen.set(true);
    }
  }

  /** Escape exits the CSS-fallback fullscreen (native fullscreen handles Esc itself). */
  @HostListener('document:keydown.escape')
  protected handleEscape(): void {
    if (this.game.running()) {
      this.exitGame();

      return;
    }
    if (this.settingsOpen()) {
      this.settingsOpen.set(false);

      return;
    }
    if (this.fullscreen() && !document.fullscreenElement) {
      this.fullscreen.set(false);
    }
  }

  /**
   * Player fist shortcuts advertised in the keys hint: `k` toggles play/pause, `j`/`l`
   * seek ∓10 s. Ignored while typing in a field or when a modifier is held (so it never
   * hijacks the contact form, the search box, or browser shortcuts).
   */
  @HostListener('document:keydown', ['$event'])
  protected handleShortcut(event: KeyboardEvent): void {
    const target = event.target;

    if (
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      (target instanceof Element && target.closest('input, textarea, select, [contenteditable]'))
    ) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'k':
        this.player.togglePlay();
        break;
      case 'j':
        this.player.seek(this.player.time() - 10);
        break;
      case 'l':
        this.player.seek(this.player.time() + 10);
        break;
      default:
        return;
    }

    this.wake();
  }

  /** Best-effort: Android honors the lock, desktop/iOS reject — ignored. Native-only. */
  private lockOrientation(): void {
    void (screen.orientation as OrientationLock | undefined)
      ?.lock?.('landscape')
      .catch(() => undefined);
  }

  private unlockOrientation(): void {
    (screen.orientation as OrientationLock | undefined)?.unlock?.();
  }
}
