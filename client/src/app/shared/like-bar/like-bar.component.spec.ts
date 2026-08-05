import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NavigationEnd, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { LikeBarComponent } from './like-bar.component';
import { FeedbackApiService, FeedbackVote, VoteTally } from '../../core/api/feedback-api.service';

interface LikeBarInternals {
  tally: () => VoteTally | null;
  counted: () => boolean;
  empty: () => boolean;
  cast: (choice: FeedbackVote) => Promise<void>;
}

describe('LikeBarComponent', () => {
  let fixture: ComponentFixture<LikeBarComponent>;
  let routerEvents: Subject<NavigationEnd>;
  let feedback: {
    loaded: VoteTally | null;
    countRejects: boolean;
    castResult: VoteTally;
    casts: Array<{ page: string; vote: FeedbackVote | null }>;
    count: (page: string) => Promise<VoteTally>;
    cast: (page: string, vote: FeedbackVote | null) => Promise<VoteTally>;
  };

  beforeEach(() => {
    routerEvents = new Subject<NavigationEnd>();
    feedback = {
      loaded: { up: 3, down: 1, mine: null },
      countRejects: false,
      castResult: { up: 4, down: 1, mine: 'up' },
      casts: [],
      count(): Promise<VoteTally> {
        return this.countRejects
          ? Promise.reject(new Error('down'))
          : Promise.resolve(this.loaded as VoteTally);
      },
      cast(page: string, vote: FeedbackVote | null): Promise<VoteTally> {
        this.casts.push({ page, vote });

        return Promise.resolve(this.castResult);
      },
    };
    TestBed.configureTestingModule({
      imports: [LikeBarComponent],
      providers: [
        { provide: FeedbackApiService, useValue: feedback },
        { provide: Router, useValue: { events: routerEvents.asObservable() } },
      ],
    });
  });

  function internals(): LikeBarInternals {
    return fixture.componentInstance as unknown as LikeBarInternals;
  }

  it('loads the tally on render and reflects the counts', async () => {
    fixture = TestBed.createComponent(LikeBarComponent);
    await fixture.whenStable();

    expect(internals().tally()).toEqual({ up: 3, down: 1, mine: null });
    expect(internals().counted()).toBe(true);
    expect(internals().empty()).toBe(false);
  });

  it('shows the "empty" state when there are no votes yet', async () => {
    feedback.loaded = { up: 0, down: 0, mine: null };
    fixture = TestBed.createComponent(LikeBarComponent);
    await fixture.whenStable();

    expect(internals().empty()).toBe(true);
    expect(internals().counted()).toBe(false);
  });

  it('stays count-less when the backend is unreachable', async () => {
    feedback.countRejects = true;
    fixture = TestBed.createComponent(LikeBarComponent);
    await fixture.whenStable();

    expect(internals().tally()).toBeNull();
    expect(internals().counted()).toBe(false);
    expect(internals().empty()).toBe(false);
  });

  it('cast() posts the vote and updates from the returned tally', async () => {
    fixture = TestBed.createComponent(LikeBarComponent);
    await fixture.whenStable();

    await internals().cast('up');

    expect(feedback.casts.at(-1)).toEqual({ page: location.pathname, vote: 'up' });
    expect(internals().tally()).toEqual({ up: 4, down: 1, mine: 'up' });
  });

  it('cast() on the current vote retracts it (sends null)', async () => {
    feedback.loaded = { up: 1, down: 0, mine: 'up' };
    feedback.castResult = { up: 0, down: 0, mine: null };
    fixture = TestBed.createComponent(LikeBarComponent);
    await fixture.whenStable();

    await internals().cast('up');

    expect(feedback.casts.at(-1)).toEqual({ page: location.pathname, vote: null });
  });

  it('reloads the tally on navigation (the bar is reused across article→article nav)', async () => {
    feedback.loaded = { up: 3, down: 1, mine: null };
    fixture = TestBed.createComponent(LikeBarComponent);
    await fixture.whenStable();

    expect(internals().tally()).toEqual({ up: 3, down: 1, mine: null });

    // Same instance survives the route change; the next page's tally must replace the old one.
    feedback.loaded = { up: 9, down: 2, mine: 'up' };
    routerEvents.next(new NavigationEnd(1, '/fr/articles/b', '/fr/articles/b'));
    await fixture.whenStable();

    expect(internals().tally()).toEqual({ up: 9, down: 2, mine: 'up' });
  });
});
