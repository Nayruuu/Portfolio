import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { typed } from '../../../../core/lib';

/**
 * Typewriter for one string — reveals a prefix from `elapsed` (reusing the `core/lib` `typed()`
 * helper). The untyped remainder is held invisible-but-space-holding (the `__ghost` span) so the
 * element is full-size from the start and never reflows as it types; a zero-width blinking caret
 * sits at the boundary while typing.
 */
@Component({
  selector: 'sd-typed',
  styleUrl: './typed.component.scss',
  templateUrl: './typed.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TypedComponent {
  public readonly elapsed = input.required<number>();
  public readonly at = input.required<number>();
  public readonly text = input.required<string>();
  public readonly cps = input<number>(40);

  protected readonly shown = computed(() =>
    typed(this.elapsed(), this.at(), this.text(), this.cps()),
  );
  protected readonly ghost = computed(() => this.text().slice(this.shown().length));
  protected readonly typing = computed(
    () => this.elapsed() >= this.at() && this.shown().length < this.text().length,
  );
}
