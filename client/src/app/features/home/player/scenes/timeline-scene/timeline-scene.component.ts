import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../../../../core/services/i18n/i18n.service';
import {
  reveal,
  typed,
  typingSchedule,
  focusedIndex,
  SCENE_BODY_CPS,
  SCENE_HEADLINE_AT,
  SCENE_HEADLINE_CPS,
  SCENE_BODY_BREATH,
  SCENE_CARD_DWELL,
} from '../../../../../core/lib';
import { TypedComponent } from '../../typed/typed.component';

@Component({
  selector: 'sd-scene-timeline',
  styleUrl: './timeline-scene.component.scss',
  templateUrl: './timeline-scene.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TypedComponent],
})
export class TimelineSceneComponent {
  public readonly active = input.required<boolean>();
  public readonly elapsed = input.required<number>();

  protected readonly data = computed(() => this.i18n.content().sceneTimeline);
  protected readonly titleTyped = computed(() =>
    typed(this.elapsed(), SCENE_HEADLINE_AT, this.data().title, SCENE_HEADLINE_CPS),
  );

  /** Sequential schedule — subtitle, then per row: year, role, company, bullets. */
  protected readonly schedule = computed(() => {
    const data = this.data();
    const texts = [
      data.subtitle,
      ...data.rows.flatMap((row) => [row.year, row.role, row.company, ...row.bullets]),
    ];
    const bodyStart =
      SCENE_HEADLINE_AT + data.title.length / SCENE_HEADLINE_CPS + SCENE_BODY_BREATH;
    const starts = typingSchedule(
      texts.map((text) => text.length),
      bodyStart,
      SCENE_BODY_CPS,
    );
    let cursor = 1;
    const rows = data.rows.map((row, rowIndex) => {
      // Push each row past the previous by a dwell, so a finished row lingers before the next.
      const dwell = rowIndex * SCENE_CARD_DWELL;
      const [yearAt, roleAt, companyAt] = starts
        .slice(cursor, cursor + 3)
        .map((start) => start + dwell);
      const bulletAts = starts
        .slice(cursor + 3, cursor + 3 + row.bullets.length)
        .map((start) => start + dwell);

      cursor += 3 + row.bullets.length;

      return { yearAt, roleAt, companyAt, bulletAts };
    });

    return { subtitleAt: starts[0], rows };
  });

  /**
   * Mobile "montage" focus: the index of the row currently being typed (the last whose `yearAt`
   * has passed). On phones only the focused row is shown, full-size; desktop shows the full rail.
   */
  protected readonly focusIndex = computed(() =>
    focusedIndex(
      this.elapsed(),
      this.schedule().rows.map((row) => row.yearAt),
    ),
  );

  protected readonly cps = SCENE_BODY_CPS;
  protected readonly reveal = reveal;

  private readonly i18n = inject(I18nService);
}
