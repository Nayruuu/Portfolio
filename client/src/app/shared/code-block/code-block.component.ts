import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { LANG_LABEL, tokenize } from '../../core/lib';
import { CodeLang, Token } from '../../domain';

interface Line {
  lineNumber: string;
  tokens: Token[];
}

@Component({
  selector: 'sd-code-block',
  templateUrl: './code-block.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeBlockComponent {
  public readonly code = input.required<string>();
  public readonly lang = input.required<CodeLang>();

  protected readonly i18n = inject(I18nService);
  protected readonly copied = signal(false);
  protected readonly label = computed(() => LANG_LABEL[this.lang()]);

  protected readonly lines = computed<Line[]>(() =>
    this.code()
      .split('\n')
      .map((line, index) => ({
        lineNumber: String(index + 1).padStart(2, ' '),
        tokens: tokenize(line, this.lang()),
      })),
  );

  protected copy(): void {
    navigator.clipboard?.writeText(this.code());
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 1400);
  }
}
