import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WritableSignal, Signal } from '@angular/core';
import { ChannelHeaderComponent } from './channel-header.component';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { FETCH_DELAY_MS } from '../../core/api/content-api.service';

/** Test view onto the protected members of ChannelHeaderComponent. */
interface ChannelInternals {
  subscribed: WritableSignal<boolean>;
  terminal: Signal<[string, string][]>;
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

  /** The subscribe button is the last action button (the only [class]-bound one). */
  function subscribeButton(): HTMLButtonElement {
    const buttons = fixture.nativeElement.querySelectorAll(
      '.profile__actions button',
    ) as NodeListOf<HTMLButtonElement>;

    return buttons[buttons.length - 1];
  }

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  it('terminal() uses the FR text for the uptime line', async () => {
    i18n.setLang('fr');
    await fixture.whenStable();

    const lines = component.terminal();

    expect(lines[0]).toEqual(['$ ', 'uptime']);
    expect(lines[1]).toEqual(['', '  9 ans, 47k commits']);
    expect(lines[2]).toEqual(['$ ', 'stack --top']);
    expect(lines[3]).toEqual(['', '  .net  angular  azure  flutter']);
  });

  it('terminal() switches to EN when the language changes', async () => {
    i18n.setLang('en');
    // Content revalidates asynchronously (stale-while-revalidate) — wait one fetch cycle.
    await new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS + 20));
    await fixture.whenStable();

    const lines = component.terminal();

    expect(lines[1]).toEqual(['', '  9 years, 47k commits']);
    // Lines without a language branch stay identical.
    expect(lines[0]).toEqual(['$ ', 'uptime']);
    expect(lines[3]).toEqual(['', '  .net  angular  azure  flutter']);
  });

  it('subscribed starts at false (initial state)', () => {
    expect(component.subscribed()).toBe(false);
  });

  it('toggle via click flips the signal, the class and the icon', async () => {
    const content = i18n.content();
    const button = subscribeButton();

    expect(component.subscribed()).toBe(false);
    expect(button.classList.contains('btn--primary')).toBe(true);
    expect(button.classList.contains('btn--grow')).toBe(true);
    expect(button.querySelector('sd-icon')).toBeNull();
    expect(button.textContent?.trim()).toContain(content.subscribe);

    button.click();
    await fixture.whenStable();

    expect(component.subscribed()).toBe(true);
    const subscribedButton = subscribeButton();

    expect(subscribedButton.classList.contains('btn--primary')).toBe(false);
    expect(subscribedButton.classList.contains('btn--grow')).toBe(true);
    expect(subscribedButton.querySelector('sd-icon')).not.toBeNull();
    expect(subscribedButton.textContent?.trim()).toContain(content.subscribed);

    subscribeButton().click();
    await fixture.whenStable();

    expect(component.subscribed()).toBe(false);
    const unsubscribedButton = subscribeButton();

    expect(unsubscribedButton.classList.contains('btn--primary')).toBe(true);
    expect(unsubscribedButton.querySelector('sd-icon')).toBeNull();
  });

  it('direct signal update reflects the class in the template', async () => {
    component.subscribed.set(true);
    await fixture.whenStable();
    expect(subscribeButton().classList.contains('btn--primary')).toBe(false);

    component.subscribed.set(false);
    await fixture.whenStable();
    expect(subscribeButton().classList.contains('btn--primary')).toBe(true);
  });
});
