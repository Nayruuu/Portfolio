import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';

import { ICONS, type IconName } from './icon-set';

export type { IconName };

/**
 * Icon — renders one of the build-time SVGs from the generated `ICONS` set, looked up by
 * `name`. Strokes use `currentColor`; `size` (px) drives the host `font-size`, so the `1em`
 * SVGs scale to it.
 */
@Component({
  selector: 'sd-icon',
  host: { '[style.font-size.px]': 'size()' },
  styleUrl: './icon.component.scss',
  templateUrl: './icon.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconComponent {
  public readonly name = input.required<IconName>();
  public readonly size = input<number>(18);

  // The SVGs are trusted, build-time assets (NOT user content), so bypassing the sanitizer
  // for this innerHTML is safe — there is no untrusted input path into `ICONS`.
  protected readonly svg = computed(() =>
    this.sanitizer.bypassSecurityTrustHtml(ICONS[this.name()]),
  );

  private readonly sanitizer = inject(DomSanitizer);
}
