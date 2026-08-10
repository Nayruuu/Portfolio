import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { IconComponent } from '../icon/icon.component';
import { FeedbackApiService, FeedbackVote, VoteTally } from '../../core/api/feedback-api.service';
import { isLang } from '../../domain';

@Component({
  selector: 'sd-like-bar',
  templateUrl: './like-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class LikeBarComponent {
  protected readonly i18n = inject(I18nService);

  protected readonly tally = signal<VoteTally | null>(null);
  protected readonly counted = computed(() => {
    const tally = this.tally();

    return tally !== null && tally.up + tally.down > 0;
  });

  private readonly feedback = inject(FeedbackApiService);
  private readonly router = inject(Router);

  constructor() {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) {
      return;
    }

    // Reused across article→article nav (route-reused host), so re-load on every navigation —
    // a one-shot load would keep showing the previous page's counts.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => void this.load());
    void this.load();
  }

  protected async cast(choice: FeedbackVote): Promise<void> {
    const next = this.tally()?.mine === choice ? null : choice;

    try {
      this.tally.set(await this.feedback.cast(this.page(), next));
    } catch {
      // Backend unreachable — keep the current state, no user-facing error for a thumb.
    }
  }

  private async load(): Promise<void> {
    try {
      this.tally.set(await this.feedback.count(this.page()));
    } catch {
      // No backend (local dev / offline) — the bar renders count-less.
    }
  }

  private page(): string {
    // Language-agnostic key: strip the leading /<lang> segment so all locales of a page share one
    // tally (/fr/articles/x and /en/articles/x count together).
    const [, first, ...rest] = location.pathname.split('/');

    return isLang(first) ? '/' + rest.join('/') : location.pathname;
  }
}
