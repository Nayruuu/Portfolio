import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomeComponent } from './home.component';
import { PlayerService } from '../../core/services/player/player.service';
import { FeedbackApiService } from '../../core/api/feedback-api.service';

// The like-bar (mounted via video-meta) fetches its tally on render; stub the API so the
// pending HTTP GET can't leave `whenStable()` hanging. The counter itself is covered by
// like-bar.component.spec.ts.
const feedback: Pick<FeedbackApiService, 'count' | 'cast'> = {
  count: () => Promise.resolve({ up: 0, down: 0, mine: null }),
  cast: () => Promise.resolve({ up: 0, down: 0, mine: null }),
};

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;

  beforeEach(async () => {
    // jsdom (the unit-test DOM) doesn't implement matchMedia, which the comments section
    // reads on the browser platform to drive its collapsed start-state. Stub a desktop-width
    // MediaQueryList so the component mounts; the collapse behaviour itself is covered by
    // comments.component.spec.ts.
    window.matchMedia = (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList;

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [{ provide: FeedbackApiService, useValue: feedback }],
    }).compileComponents();
    TestBed.inject(PlayerService).pause();
    fixture = TestBed.createComponent(HomeComponent);
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });
});
