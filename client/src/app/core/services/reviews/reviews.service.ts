import { Injectable, effect, signal } from '@angular/core';
import { STORAGE_KEYS } from '../../lib';

/**
 * Visitor-posted reviews (the "leave a comment" testimonials), kept newest-first and persisted to
 * localStorage so they survive a reload. Client-only for now — this is the seam the real .NET API
 * will replace in the next phase; the component maps each stored body onto a `Comment` with the
 * localized "you / visitor / just now" labels.
 */
@Injectable({ providedIn: 'root' })
export class ReviewsService {
  public readonly posted = signal<readonly string[]>(this.readInitial());

  constructor() {
    effect(() => {
      const current = this.posted();

      try {
        localStorage.setItem(STORAGE_KEYS.REVIEWS, JSON.stringify(current));
      } catch {
        /* localStorage indisponible */
      }
    });
  }

  public add(body: string): void {
    this.posted.update((current) => [body, ...current]);
  }

  private readInitial(): readonly string[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.REVIEWS);
      const parsed: unknown = raw ? JSON.parse(raw) : [];

      return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')
        ? parsed
        : [];
    } catch {
      return [];
    }
  }
}
