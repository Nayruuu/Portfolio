import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { API_BASE_URL } from './api.token';

export const FEEDBACK_TIMEOUT_MS = 10_000;

export type FeedbackVote = 'up' | 'down';

export interface VoteTally {
  up: number;
  down: number;
  /** The caller's own current vote (server-authoritative, keyed by hashed IP), or null. */
  mine: FeedbackVote | null;
}

// Server-authoritative (dedup by hashed IP): reads and writes both return the fresh tally — no
// local cache, no fabricated numbers.
@Injectable({ providedIn: 'root' })
export class FeedbackApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  public count(page: string): Promise<VoteTally> {
    return firstValueFrom(
      this.http
        .get<VoteTally>(`${this.baseUrl}/feedback`, { params: { page } })
        .pipe(timeout(FEEDBACK_TIMEOUT_MS)),
    );
  }

  public cast(page: string, vote: FeedbackVote | null): Promise<VoteTally> {
    return firstValueFrom(
      this.http
        .post<VoteTally>(`${this.baseUrl}/feedback`, { page, vote })
        .pipe(timeout(FEEDBACK_TIMEOUT_MS)),
    );
  }
}
