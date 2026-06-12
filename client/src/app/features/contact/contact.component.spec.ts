import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContactKind } from '../../domain';
import { ContactComponent } from './contact.component';

describe('ContactComponent', () => {
  let fixture: ComponentFixture<ContactComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ContactComponent] }).compileComponents();
    fixture = TestBed.createComponent(ContactComponent);
  });

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  // submit/state/iconOf are protected; reach them via a typed cast on the instance.
  // `submit` only reads `form.invalid`, so a minimal stand-in stands in for `NgForm`.
  type ContactInternals = {
    state: () => 'idle' | 'sending' | 'sent';
    submitted: () => boolean;
    submit: (form: { invalid: boolean }) => void;
    iconOf: (kind: ContactKind) => string;
  };
  const internals = (): ContactInternals =>
    fixture.componentInstance as unknown as ContactInternals;

  const validForm = { invalid: false };
  const invalidForm = { invalid: true };

  describe('submit()', () => {
    it('blocks an invalid form — stays idle and flags `submitted`', () => {
      expect(internals().state()).toBe('idle');

      internals().submit(invalidForm);

      expect(internals().state()).toBe('idle');
      expect(internals().submitted()).toBe(true);
    });

    it('immediately switches a valid form to the "sending" state', () => {
      expect(internals().state()).toBe('idle');

      internals().submit(validForm);

      expect(internals().state()).toBe('sending');
    });

    it('disables the submit button when the state is no longer "idle"', async () => {
      await fixture.whenStable();
      const button = (): HTMLButtonElement =>
        fixture.nativeElement.querySelector('button[type="submit"]');

      expect(button().disabled).toBe(false);

      internals().submit(validForm);
      await fixture.whenStable();

      expect(button().disabled).toBe(true);
    });

    // Zoneless means no zone.js, so fakeAsync/tick are unavailable. Use Vitest's
    // fake timers to drive the setTimeout(1100ms).
    it('switches to the "sent" state after the setTimeout (1100 ms)', () => {
      vi.useFakeTimers();

      internals().submit(validForm);
      expect(internals().state()).toBe('sending');

      vi.advanceTimersByTime(1100);

      expect(internals().state()).toBe('sent');
    });
  });

  afterEach(() => vi.useRealTimers());

  describe('iconOf()', () => {
    it('returns "@" for mail', () => {
      expect(internals().iconOf('mail')).toBe('@');
    });

    it('returns "in" for linkedin', () => {
      expect(internals().iconOf('linkedin')).toBe('in');
    });

    it('returns "gh" for github', () => {
      expect(internals().iconOf('github')).toBe('gh');
    });

    it('returns "▽" for cal', () => {
      expect(internals().iconOf('cal')).toBe('▽');
    });

    it('returns "•" for an unknown kind (default)', () => {
      expect(internals().iconOf('autre' as ContactKind)).toBe('•');
    });
  });
});
