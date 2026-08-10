import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { VideoMetaComponent } from './video-meta.component';

interface VideoMetaInternals {
  share: () => Promise<void>;
  copied: () => boolean;
}

type MutableNavigator = {
  share?: (data: { url?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

describe('VideoMetaComponent', () => {
  let fixture: ComponentFixture<VideoMetaComponent>;
  let component: VideoMetaInternals;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [VideoMetaComponent] }).compileComponents();
    fixture = TestBed.createComponent(VideoMetaComponent);
    component = fixture.componentInstance as unknown as VideoMetaInternals;
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  it('share() hands the current URL to the native share sheet when available', async () => {
    const shared: Array<{ url?: string }> = [];

    (navigator as unknown as MutableNavigator).share = (data) => {
      shared.push(data);

      return Promise.resolve();
    };

    await component.share();

    expect(shared).toHaveLength(1);
    expect(shared[0].url).toBe(location.href);
    expect(component.copied()).toBe(false);
    (navigator as unknown as MutableNavigator).share = undefined;
  });

  it('share() copies the link and flags "copied" when native share is unavailable', async () => {
    (navigator as unknown as MutableNavigator).share = undefined;
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

    await component.share();

    expect(copiedText).toBe(location.href);
    expect(component.copied()).toBe(true);
  });
});
