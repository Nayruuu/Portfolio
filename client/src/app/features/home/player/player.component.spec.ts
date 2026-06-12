import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApplicationRef } from '@angular/core';
import { PlayerComponent } from './player.component';
import { PlayerService } from '../../../core/services/player/player.service';

describe('PlayerComponent', () => {
  let fixture: ComponentFixture<PlayerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PlayerComponent] }).compileComponents();
    TestBed.inject(PlayerService).pause();
    fixture = TestBed.createComponent(PlayerComponent);
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'fullscreenEnabled');
    Reflect.deleteProperty(document, 'fullscreenElement');
  });

  /** The fullscreen button — the last `.player__btn` in `.player__row`. */
  function fullButton(): HTMLButtonElement {
    const buttons = fixture.nativeElement.querySelectorAll('.player__row button.player__btn');

    return buttons[buttons.length - 1] as HTMLButtonElement;
  }

  function playerBox(): HTMLElement {
    return fixture.nativeElement.querySelector('.player') as HTMLElement;
  }

  /** The ⚙️ settings gear (aria label from FR content). */
  function gearButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector(
      '.player__btn--aux[aria-label="Paramètres"]',
    ) as HTMLButtonElement;
  }

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  it('toggles the CSS fallback fullscreen when the native API is unavailable (iOS path)', async () => {
    // jsdom has no Fullscreen API — `document.fullscreenEnabled` is falsy, which IS this branch.
    await fixture.whenStable();

    fullButton().click();
    TestBed.inject(ApplicationRef).tick();
    expect(playerBox().classList.contains('is-fullscreen')).toBe(true);
    expect(fullButton().getAttribute('aria-label')).toBe('Quitter le plein écran');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    TestBed.inject(ApplicationRef).tick();
    expect(playerBox().classList.contains('is-fullscreen')).toBe(false);
    expect(fullButton().getAttribute('aria-label')).toBe('Plein écran');
  });

  it('uses the native API when available and syncs from fullscreenchange', async () => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    // Fresh component AFTER the stub — the flag is read at construction.
    fixture = TestBed.createComponent(PlayerComponent);
    await fixture.whenStable();
    const requestStub = vi.fn().mockResolvedValue(undefined);

    playerBox().requestFullscreen = requestStub;
    fullButton().click();
    expect(requestStub).toHaveBeenCalledOnce();

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: playerBox(),
    });
    document.dispatchEvent(new Event('fullscreenchange'));
    TestBed.inject(ApplicationRef).tick();
    expect(playerBox().classList.contains('is-fullscreen')).toBe(true);

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    document.dispatchEvent(new Event('fullscreenchange'));
    TestBed.inject(ApplicationRef).tick();
    expect(playerBox().classList.contains('is-fullscreen')).toBe(false);
  });

  it('the settings gear opens a speed menu that drives the player rate, then closes', async () => {
    await fixture.whenStable();
    const player = TestBed.inject(PlayerService);

    expect(fixture.nativeElement.querySelector('.player__settings')).toBeNull();

    gearButton().click();
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    const items = fixture.nativeElement.querySelectorAll('.player__settings-item');

    expect(items.length).toBe(4);

    (items[items.length - 1] as HTMLButtonElement).click(); // "2×"
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    expect(player.rate()).toBe(2);
    expect(fixture.nativeElement.querySelector('.player__settings')).toBeNull();
  });

  it('Escape closes the speed menu first (before exiting fullscreen)', async () => {
    await fixture.whenStable();
    gearButton().click();
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.player__settings')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    TestBed.inject(ApplicationRef).tick();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.player__settings')).toBeNull();
  });
});
