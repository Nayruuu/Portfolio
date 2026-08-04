import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ContactFormState, ContactKind, ContactMethod } from '../../domain';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { ContactApiService } from '../../core/api/contact-api.service';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'sd-contact',
  host: { class: 'tab-pane' },
  styleUrl: './contact.component.scss',
  templateUrl: './contact.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, IconComponent],
})
export class ContactComponent {
  protected readonly i18n = inject(I18nService);

  protected name = '';
  protected email = '';
  protected subject = this.i18n.content().contact.subjects[0];
  protected message = '';

  protected website = '';

  protected readonly state = signal<ContactFormState>('idle');

  protected readonly submitted = signal(false);

  protected readonly placeholder = computed(() => this.i18n.content().contact.messagePlaceholder);

  protected readonly shortSent = computed(() =>
    this.i18n.content().contact.formLabels.sent.split('—')[0].trim(),
  );

  protected readonly submitLocked = computed(
    () => this.state() === 'sending' || this.state() === 'sent',
  );

  private readonly contactApi = inject(ContactApiService);

  protected async submit(form: NgForm): Promise<void> {
    if (form.invalid) {
      this.submitted.set(true);
      this.focusFirstInvalid(form);

      return;
    }

    this.state.set('sending');

    try {
      await this.contactApi.send({
        name: this.name,
        email: this.email,
        subject: this.subject,
        message: this.message,
        website: this.website,
      });
      this.state.set('sent');
    } catch {
      this.state.set('error');
    }
  }

  protected iconOf(kind: ContactKind): string {
    switch (kind) {
      case 'mail':
        return '@';
      case 'linkedin':
        return 'in';
      case 'github':
        return 'gh';
      case 'cal':
        return '▽';
      default:
        kind satisfies never;

        return '•';
    }
  }

  protected linkOf(method: ContactMethod): string {
    return method.kind === 'mail' ? `mailto:${method.label}` : `https://${method.label}`;
  }

  private focusFirstInvalid(form: NgForm): void {
    const firstInvalid = ['name', 'email', 'message'].find(
      (name) => form.controls?.[name]?.invalid,
    );

    if (firstInvalid) {
      document.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
    }
  }
}
