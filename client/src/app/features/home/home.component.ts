import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlayerComponent } from './player/player.component';
import { VideoMetaComponent } from './video-meta/video-meta.component';
import { LetsTalkComponent } from './lets-talk/lets-talk.component';
import { ReviewsComponent } from './reviews/reviews.component';
import { UpNextComponent } from './up-next/up-next.component';

/**
 * Home tab — the "watch page": player + meta + the let's-talk CTA on the left,
 * recent-articles sidebar on the right.
 */
@Component({
  selector: 'sd-home',
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerComponent, VideoMetaComponent, ReviewsComponent, LetsTalkComponent, UpNextComponent],
})
export class HomeComponent {}
