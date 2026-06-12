import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../../../../../core/services/i18n/i18n.service';
import { reveal, typed, typingSchedule, SCENE_BODY_CPS, SCENE_HEADLINE_AT, SCENE_HEADLINE_CPS, SCENE_BODY_BREATH } from '../../../../../core/lib';
import { TypedComponent } from '../../typed/typed.component';

@Component({
  selector: 'sd-scene-outro',
  styleUrl: './outro-scene.component.scss',
  templateUrl: './outro-scene.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TypedComponent],
})
export class OutroSceneComponent {
  public readonly active = input.required<boolean>();
  public readonly elapsed = input.required<number>();

  protected readonly data = computed(() => this.i18n.content().sceneOutro);
  protected readonly hashTyped = computed(() =>
    typed(this.elapsed(), SCENE_HEADLINE_AT, this.data().hash, SCENE_HEADLINE_CPS),
  );

  /** Sequential schedule — subtitle, cta, links, sign-off. */
  protected readonly schedule = computed(() => {
    const data = this.data();
    const labels = data.links.map((link) => link.label);
    const texts = [data.subtitle, data.cta, ...labels, data.sign];
    const bodyStart = SCENE_HEADLINE_AT + data.hash.length / SCENE_HEADLINE_CPS + SCENE_BODY_BREATH;
    const starts = typingSchedule(
      texts.map((text) => text.length),
      bodyStart,
      SCENE_BODY_CPS,
    );

    return {
      subtitleAt: starts[0],
      ctaAt: starts[1],
      linkAts: starts.slice(2, 2 + labels.length),
      signAt: starts[2 + labels.length],
    };
  });

  protected readonly cps = SCENE_BODY_CPS;
  protected readonly reveal = reveal;

  private readonly i18n = inject(I18nService);
}
