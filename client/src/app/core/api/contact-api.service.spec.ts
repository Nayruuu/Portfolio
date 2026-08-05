import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ContactApiService, SEND_TIMEOUT_MS } from './contact-api.service';

describe('ContactApiService', () => {
  let service: ContactApiService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ContactApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    httpMock.verify();
  });

  const submission = {
    name: 'Jane',
    email: 'jane@example.com',
    subject: 'Mission',
    message: 'Bonjour',
    website: '',
    altcha: 'solved',
  };

  it('POSTs the submission to {baseUrl}/contact and resolves on a 2xx', async () => {
    const done = service.send(submission);

    const request = httpMock.expectOne('/api/contact');

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual(submission);
    request.flush(null, { status: 202, statusText: 'Accepted' });

    await expect(done).resolves.toBeUndefined();
  });

  it('rejects and cancels the request when the API hangs beyond the timeout', async () => {
    vi.useFakeTimers();
    const done = service.send(submission);
    const request = httpMock.expectOne('/api/contact');

    vi.advanceTimersByTime(SEND_TIMEOUT_MS);

    await expect(done).rejects.toBeDefined();
    expect(request.cancelled).toBe(true);
  });

  it('rejects when the API returns an error status', async () => {
    const done = service.send(submission);

    httpMock.expectOne('/api/contact').flush('down', { status: 502, statusText: 'Bad Gateway' });

    await expect(done).rejects.toBeDefined();
  });
});
