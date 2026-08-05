import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Signal } from '@angular/core';
import { ChannelHeaderComponent } from './channel-header.component';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { FETCH_DELAY_MS } from '../../core/api/content-api.service';

/** Test view onto the protected members of ChannelHeaderComponent. */
interface ChannelInternals {
  terminal: Signal<[string, string][]>;
  copied: Signal<boolean>;
  share: () => Promise<void>;
}

describe('ChannelHeaderComponent', () => {
  let fixture: ComponentFixture<ChannelHeaderComponent>;
  let component: ChannelInternals;
  let i18n: I18nService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ChannelHeaderComponent] }).compileComponents();
    fixture = TestBed.createComponent(ChannelHeaderComponent);
    component = fixture.componentInstance as unknown as ChannelInternals;
    i18n = TestBed.inject(I18nService);
    i18n.setLang('fr');
    await fixture.whenStable();
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  it('terminal() uses the FR text for the uptime line', async () => {
    i18n.setLang('fr');
    await fixture.whenStable();

    const lines = component.terminal();

    expect(lines[0]).toEqual(['$ ', 'uptime']);
    expect(lines[1]).toEqual(['', '  9 ans, de la conception au run']);
    expect(lines[2]).toEqual(['$ ', 'stack --top']);
    expect(lines[3]).toEqual(['', '  .net  angular  azure  flutter']);
  });

  it('terminal() switches to EN when the language changes', async () => {
    i18n.setLang('en');
    // Content revalidates asynchronously (stale-while-revalidate) — wait one fetch cycle.
    await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS + 20));
    await fixture.whenStable();

    const lines = component.terminal();

    expect(lines[1]).toEqual(['', '  9 years, from design to run']);
    expect(lines[0]).toEqual(['$ ', 'uptime']);
    expect(lines[3]).toEqual(['', '  .net  angular  azure  flutter']);
  });

  type MutableNavigator = {
    share?: (data: { url?: string }) => Promise<void>;
    clipboard?: { writeText: (text: string) => Promise<void> };
  };

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

  it('share() swallows a cancelled native share', async () => {
    (navigator as unknown as MutableNavigator).share = () => Promise.reject(new Error('cancelled'));

    await expect(component.share()).resolves.toBeUndefined();

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
