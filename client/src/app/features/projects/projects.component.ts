import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/services/i18n/i18n.service';
import type { ProjectScene } from '../../domain';

@Component({
  selector: 'sd-projects',
  host: { class: 'tab-pane' },
  styleUrl: './projects.component.scss',
  templateUrl: './projects.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
})
export class ProjectsComponent {
  protected readonly i18n = inject(I18nService);

  /** Only projects with a `slug` have a page. */
  protected readonly projects = computed<ProjectScene[]>(() =>
    this.i18n.content().projectScenes.filter((project) => Boolean(project.slug)),
  );
}
