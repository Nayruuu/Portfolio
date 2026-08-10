import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { ContactSubmission } from '../../domain';
import { API_BASE_URL } from './api.token';

export const SEND_TIMEOUT_MS = 15_000;

@Injectable({ providedIn: 'root' })
export class ContactApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  public async send(submission: ContactSubmission): Promise<void> {
    await firstValueFrom(
      this.http.post(`${this.baseUrl}/contact`, submission).pipe(timeout(SEND_TIMEOUT_MS)),
    );
  }
}
