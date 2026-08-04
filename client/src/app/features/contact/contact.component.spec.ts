import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ContactFormState, ContactKind } from '../../domain';
import { ContactComponent } from './contact.component';

describe('ContactComponent', () => {
  let fixture: ComponentFixture<ContactComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContactComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ContactComponent);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('mounts without error and renders content', async () => {
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim().length).toBeGreaterThan(0);
  });

  type ContactInternals = {
    state: () => ContactFormState;
    submitted: () => boolean;
    submit: (form: { invalid: boolean }) => Promise<void>;
    iconOf: (kind: ContactKind) => string;
    name: string;
    email: string;
    subject: string;
    message: string;
    website: string;
  };
  const internals = (): ContactInternals =>
    fixture.componentInstance as unknown as ContactInternals;

  const validForm = { invalid: false };
  const invalidForm = { invalid: true };

  describe('submit()', () => {
    it('blocks an invalid form — stays idle, flags `submitted`, and sends nothing', async () => {
      expect(internals().state()).toBe('idle');

      await internals().submit(invalidForm);

      expect(internals().state()).toBe('idle');
      expect(internals().submitted()).toBe(true);
      httpMock.expectNone('/api/contact');
    });

    it('POSTs the form (honeypot included) to /api/contact and reaches "sent" on success', async () => {
      const contact = internals();

      contact.name = 'Jane';
      contact.email = 'jane@example.com';
      contact.subject = 'Mission';
      contact.message = 'Bonjour';

      const done = contact.submit(validForm);

      expect(contact.state()).toBe('sending');

      const request = httpMock.expectOne('/api/contact');

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({
        name: 'Jane',
        email: 'jane@example.com',
        subject: 'Mission',
        message: 'Bonjour',
        website: '',
      });
      request.flush(null, { status: 202, statusText: 'Accepted' });
      await done;

      expect(contact.state()).toBe('sent');
    });

    it('reaches the "error" state when the POST fails', async () => {
      const done = internals().submit(validForm);

      httpMock.expectOne('/api/contact').flush('down', { status: 500, statusText: 'Server Error' });
      await done;

      expect(internals().state()).toBe('error');
    });

    it('disables the submit button while sending', async () => {
      await fixture.whenStable();
      const button = (): HTMLButtonElement =>
        fixture.nativeElement.querySelector('button[type="submit"]');

      expect(button().disabled).toBe(false);

      const done = internals().submit(validForm);

      await fixture.whenStable();

      expect(button().disabled).toBe(true);

      httpMock.expectOne('/api/contact').flush(null, { status: 202, statusText: 'Accepted' });
      await done;
    });
  });

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
