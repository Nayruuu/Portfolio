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
  selector: 'sd-scene-stack',
  styleUrl: './stack-scene.component.scss',
  templateUrl: './stack-scene.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TypedComponent],
})
export class StackSceneComponent {
  public readonly active = input.required<boolean>();
  public readonly elapsed = input.required<number>();

  protected readonly data = computed(() => this.i18n.content().sceneStack);
  protected readonly titleTyped = computed(() =>
    typed(this.elapsed(), SCENE_HEADLINE_AT, this.data().title, SCENE_HEADLINE_CPS),
  );

  /** Sequential schedule — subtitle, then per card: title, main label, items. */
  protected readonly schedule = computed(() => {
    const data = this.data();
    const texts = [
      data.subtitle,
      ...data.cards.flatMap((card) => [card.title, card.mainLabel, ...card.items]),
    ];
    const bodyStart =
      SCENE_HEADLINE_AT + data.title.length / SCENE_HEADLINE_CPS + SCENE_BODY_BREATH;
    const starts = typingSchedule(
      texts.map((text) => text.length),
      bodyStart,
      SCENE_BODY_CPS,
    );
    let cursor = 1;
    const cards = data.cards.map((card, cardIndex) => {
      // Push each card past the previous by a dwell, so a finished card lingers before the next.
      const dwell = cardIndex * SCENE_CARD_DWELL;
      const titleAt = starts[cursor] + dwell;
      const mainAt = starts[cursor + 1] + dwell;
      const itemAts = starts
        .slice(cursor + 2, cursor + 2 + card.items.length)
        .map((start) => start + dwell);

      cursor += 2 + card.items.length;

      return { titleAt, mainAt, itemAts };
    });

    return { subtitleAt: starts[0], cards };
  });

  /**
   * Mobile "montage" focus: the index of the card currently being typed (the last whose `titleAt`
   * has passed). On phones only the focused card is shown, full-size; desktop shows the full grid.
   */
  protected readonly focusIndex = computed(() =>
    focusedIndex(
      this.elapsed(),
      this.schedule().cards.map((card) => card.titleAt),
    ),
  );

  protected readonly cps = SCENE_BODY_CPS;
  protected readonly reveal = reveal;

  private readonly i18n = inject(I18nService);
}
