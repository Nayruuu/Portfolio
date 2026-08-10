import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { FeedbackApiService, FEEDBACK_TIMEOUT_MS } from './feedback-api.service';

describe('FeedbackApiService', () => {
  let service: FeedbackApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(FeedbackApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  const tally = { up: 3, down: 1, mine: 'up' as const };

  it('count() GETs {baseUrl}/feedback with the page param and resolves the tally', async () => {
    const done = service.count('/fr');

    const request = httpMock.expectOne(
      (r) => r.method === 'GET' && r.url === '/api/feedback' && r.params.get('page') === '/fr',
    );

    request.flush(tally);

    await expect(done).resolves.toEqual(tally);
  });

  it('cast() POSTs the page + vote and resolves the fresh tally', async () => {
    const done = service.cast('/fr', 'down');

    const request = httpMock.expectOne('/api/feedback');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ page: '/fr', vote: 'down' });
    request.flush({ up: 3, down: 2, mine: 'down' });

    await expect(done).resolves.toEqual({ up: 3, down: 2, mine: 'down' });
  });

  it('cast() sends vote:null to retract', async () => {
    const done = service.cast('/fr', null);

    const request = httpMock.expectOne('/api/feedback');

    expect(request.request.body).toEqual({ page: '/fr', vote: null });
    request.flush({ up: 2, down: 1, mine: null });

    await expect(done).resolves.toEqual({ up: 2, down: 1, mine: null });
  });

  it('rejects when the API errors', async () => {
    const done = service.cast('/fr', 'up');

    httpMock.expectOne('/api/feedback').flush('down', { status: 500, statusText: 'Server Error' });

    await expect(done).rejects.toBeDefined();
  });

  it('rejects and cancels the request when the API hangs beyond the timeout', async () => {
    vi.useFakeTimers();
    const done = service.cast('/fr', 'up');
    const request = httpMock.expectOne('/api/feedback');

    vi.advanceTimersByTime(FEEDBACK_TIMEOUT_MS);

    await expect(done).rejects.toBeDefined();
    expect(request.cancelled).toBe(true);
  });
});
