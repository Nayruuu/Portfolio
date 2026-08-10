import { Injectable } from '@angular/core';

export interface ShareTarget {
  title: string;
  text: string;
  url: string;
}

/** Whether the native share sheet was used, or the URL was copied as a fallback. */
export type ShareOutcome = 'shared' | 'copied';

@Injectable({ providedIn: 'root' })
export class ShareService {
  public async share(target: ShareTarget): Promise<ShareOutcome> {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(target);
      } catch {
        // The native sheet rejects on user-cancel — a no-op we intentionally swallow.
      }

      return 'shared';
    }

    await navigator.clipboard?.writeText(target.url);

    return 'copied';
  }
}
