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
  selector: 'sd-scene-projects',
  styleUrl: './projects-scene.component.scss',
  templateUrl: './projects-scene.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TypedComponent],
})
export class ProjectsSceneComponent {
  public readonly active = input.required<boolean>();
  public readonly elapsed = input.required<number>();

  protected readonly data = computed(() => this.i18n.content().sceneProjects);
  protected readonly projects = computed(() => this.i18n.content().projectScenes);
  protected readonly titleTyped = computed(() =>
    typed(this.elapsed(), SCENE_HEADLINE_AT, this.data().heading, SCENE_HEADLINE_CPS),
  );

  /** Sequential schedule — subtitle, then per project: number, tag, name, metric, role, description, chips. */
  protected readonly schedule = computed(() => {
    const projects = this.projects();
    const texts = [
      this.data().subtitle,
      ...projects.flatMap((project) => [
        project.number,
        project.tag,
        project.name,
        project.metric,
        project.role,
        project.description,
        ...project.stack,
      ]),
    ];
    const bodyStart =
      SCENE_HEADLINE_AT + this.data().heading.length / SCENE_HEADLINE_CPS + SCENE_BODY_BREATH;
    const starts = typingSchedule(
      texts.map((text) => text.length),
      bodyStart,
      SCENE_BODY_CPS,
    );
    let cursor = 1;
    const cards = projects.map((project, cardIndex) => {
      // Push each card past the previous by a dwell, so a finished card lingers before the next.
      const dwell = cardIndex * SCENE_CARD_DWELL;
      const [numberAt, tagAt, nameAt, metricAt, roleAt, descriptionAt] = starts
        .slice(cursor, cursor + 6)
        .map((start) => start + dwell);
      const chipAts = starts
        .slice(cursor + 6, cursor + 6 + project.stack.length)
        .map((start) => start + dwell);

      cursor += 6 + project.stack.length;

      return { numberAt, tagAt, nameAt, metricAt, roleAt, descriptionAt, chipAts };
    });

    return { subtitleAt: starts[0], cards };
  });

  /**
   * Mobile "montage" focus: the index of the card currently being typed (the last whose `numberAt`
   * has passed). On phones only the focused card is shown, full-size; desktop shows the full list.
   */
  protected readonly focusIndex = computed(() =>
    focusedIndex(
      this.elapsed(),
      this.schedule().cards.map((card) => card.numberAt),
    ),
  );

  protected readonly cps = SCENE_BODY_CPS;
  protected readonly reveal = reveal;

  private readonly i18n = inject(I18nService);
}
