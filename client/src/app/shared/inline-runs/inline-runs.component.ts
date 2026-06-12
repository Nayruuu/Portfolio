import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { InlineRun } from '../../domain';

/** Renders an `InlineRun[]` as bound `<strong>`/`<code>`/`<a>`/text — never innerHTML. */
@Component({
  selector: 'sd-inline-runs',
  styleUrl: './inline-runs.component.scss',
  templateUrl: './inline-runs.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InlineRunsComponent {
  public readonly runs = input.required<InlineRun[]>();

  /** External links open in a new tab; relative/internal links stay in place. */
  protected isExternal(href: string | undefined): boolean {
    return /^https?:\/\//i.test(href ?? '');
  }
}
