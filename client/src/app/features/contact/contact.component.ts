import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { ContactKind, ContactMethod } from '../../domain';
import { I18nService } from '../../core/services/i18n/i18n.service';
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

  protected readonly state = signal<'idle' | 'sending' | 'sent'>('idle');

  /** Flipped on the first submit attempt — gates the inline error display until then. */
  protected readonly submitted = signal(false);

  protected readonly placeholder = computed(() => this.i18n.content().contact.messagePlaceholder);

  protected readonly shortSent = computed(() =>
    this.i18n.content().contact.formLabels.sent.split('—')[0].trim(),
  );

  protected submit(form: NgForm): void {
    if (form.invalid) {
      this.submitted.set(true);
      this.focusFirstInvalid(form);

      return;
    }

    this.state.set('sending');
    setTimeout(() => this.state.set('sent'), 1100);
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

  /** Real destination for a contact channel — `mailto:` for the email, `https://` for the rest. */
  protected linkOf(method: ContactMethod): string {
    return method.kind === 'mail' ? `mailto:${method.label}` : `https://${method.label}`;
  }

  /** Move focus to the first field in error so a fist/SR user lands on what to fix. */
  private focusFirstInvalid(form: NgForm): void {
    const firstInvalid = ['name', 'email', 'message'].find(
      (name) => form.controls?.[name]?.invalid,
    );

    if (firstInvalid) {
      document.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus();
    }
  }
}
