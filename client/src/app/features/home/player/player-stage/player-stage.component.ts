import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PlayerService } from '../../../../core/services/player/player.service';
import { IntroSceneComponent } from '../scenes/intro-scene/intro-scene.component';
import { StackSceneComponent } from '../scenes/stack-scene/stack-scene.component';
import { ProjectsSceneComponent } from '../scenes/projects-scene/projects-scene.component';
import { TimelineSceneComponent } from '../scenes/timeline-scene/timeline-scene.component';
import { OutroSceneComponent } from '../scenes/outro-scene/outro-scene.component';

/**
 * The player "stage" — the animated scene layer (background + the five chapter scenes), driven by
 * `PlayerService`. Extracted so it renders both inline (the main player) and in the floating
 * mini-player without duplicating the scene wiring. It fills its container absolutely; `.scene--fit`
 * scales the fixed-width scenes down to whatever size-query box it is placed in.
 */
@Component({
  selector: 'sd-player-stage',
  styleUrl: './player-stage.component.scss',
  templateUrl: './player-stage.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IntroSceneComponent,
    StackSceneComponent,
    ProjectsSceneComponent,
    TimelineSceneComponent,
    OutroSceneComponent,
  ],
})
export class PlayerStageComponent {
  protected readonly player = inject(PlayerService);
}
