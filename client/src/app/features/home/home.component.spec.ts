import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HomeComponent } from './home.component';
import { PlayerService } from '../../core/services/player/player.service';

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

    await TestBed.configureTestingModule({ imports: [HomeComponent] }).compileComponents();
    TestBed.inject(PlayerService).pause();
    fixture = TestBed.createComponent(HomeComponent);
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });
});
