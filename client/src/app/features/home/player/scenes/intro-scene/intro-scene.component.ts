import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../../../../core/services/i18n/i18n.service';
import {
  reveal,
  typed,
  typingSchedule,
  SCENE_BODY_CPS,
  SCENE_HEADLINE_AT,
  SCENE_HEADLINE_CPS,
  SCENE_BODY_BREATH,
} from '../../../../../core/lib';
import { TypedComponent } from '../../typed/typed.component';

@Component({
  selector: 'sd-scene-intro',
  styleUrl: './intro-scene.component.scss',
  templateUrl: './intro-scene.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TypedComponent],
})
export class IntroSceneComponent {
  public readonly active = input.required<boolean>();
  public readonly elapsed = input.required<number>();

  protected readonly data = computed(() => this.i18n.content().sceneIntro);
  protected readonly typedHi = computed(() =>
    typed(this.elapsed(), SCENE_HEADLINE_AT, this.data().hi, SCENE_HEADLINE_CPS),
  );

  /** Sequential schedule — name, role, tagline, tags, then per metric: value, label. */
  protected readonly schedule = computed(() => {
    const data = this.data();
    const texts = [
      data.name,
      data.role,
      data.tagline,
      ...data.tags,
      ...data.metrics.flatMap((metric) => [metric.value, metric.label]),
    ];
    const bodyStart = SCENE_HEADLINE_AT + data.hi.length / SCENE_HEADLINE_CPS + SCENE_BODY_BREATH;
    const starts = typingSchedule(
      texts.map((text) => text.length),
      bodyStart,
      SCENE_BODY_CPS,
    );
    const tagAts = starts.slice(3, 3 + data.tags.length);
    const metricsBase = 3 + data.tags.length;
    const metrics = data.metrics.map((metric, metricIndex) => ({
      valueAt: starts[metricsBase + metricIndex * 2],
      labelAt: starts[metricsBase + metricIndex * 2 + 1],
    }));

    return { nameAt: starts[0], roleAt: starts[1], taglineAt: starts[2], tagAts, metrics };
  });

  protected readonly cps = SCENE_BODY_CPS;
  protected readonly reveal = reveal;

  private readonly i18n = inject(I18nService);
}
