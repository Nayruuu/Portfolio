import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PlayerComponent } from './player/player.component';
import { VideoMetaComponent } from './video-meta/video-meta.component';
import { CommentsComponent } from './comments/comments.component';
import { UpNextComponent } from './up-next/up-next.component';

/**
 * Home tab — the "watch page": player + meta + comments on the left,
 * recent-articles sidebar on the right.
 */
@Component({
  selector: 'sd-home',
  templateUrl: './home.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlayerComponent, VideoMetaComponent, CommentsComponent, UpNextComponent],
})
export class HomeComponent {}
