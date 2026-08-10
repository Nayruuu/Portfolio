import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ArticleDetailComponent } from './article-detail.component';
import { FeedbackApiService } from '../../../core/api/feedback-api.service';

// The like-bar fetches its tally on render; stub the API so the pending HTTP GET can't leave
// `whenStable()` hanging. The counter itself is covered by like-bar.component.spec.ts.
const feedback: Pick<FeedbackApiService, 'count' | 'cast'> = {
  count: () => Promise.resolve({ up: 0, down: 0, mine: null }),
  cast: () => Promise.resolve({ up: 0, down: 0, mine: null }),
};

describe('ArticleDetailComponent', () => {
  let fixture: ComponentFixture<ArticleDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ArticleDetailComponent],
      providers: [{ provide: FeedbackApiService, useValue: feedback }],
    }).compileComponents();
    fixture = TestBed.createComponent(ArticleDetailComponent);
    fixture.componentRef.setInput('slug', 'etrangler-le-monolithe-dotnet');
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  type ShareInternals = { share: () => Promise<void>; copied: () => boolean };

  it('share() copies the article URL and flashes "copied" when native share is unavailable', async () => {
    await fixture.whenStable();
    (navigator as unknown as { share?: unknown }).share = undefined;
    let copiedText = '';

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          copiedText = text;

          return Promise.resolve();
        },
      },
    });

    await (fixture.componentInstance as unknown as ShareInternals).share();

    expect(copiedText).toBe(location.href);
    expect((fixture.componentInstance as unknown as ShareInternals).copied()).toBe(true);
  });

  it('share() uses the native share sheet without flashing "copied"', async () => {
    await fixture.whenStable();
    (navigator as unknown as { share?: () => Promise<void> }).share = () => Promise.resolve();

    await (fixture.componentInstance as unknown as ShareInternals).share();

    expect((fixture.componentInstance as unknown as ShareInternals).copied()).toBe(false);
    (navigator as unknown as { share?: unknown }).share = undefined;
  });
});
