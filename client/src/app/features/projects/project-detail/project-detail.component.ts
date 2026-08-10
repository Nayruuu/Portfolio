import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../../core/services/i18n/i18n.service';
import { PROJECTS, type ProjectMeta } from '../../../core/lib';
import { CodeBlockComponent } from '../../../shared/code-block/code-block.component';
import type { ProjectScene } from '../../../domain';

interface ProjectLink {
  label: string;
  href: string;
}

@Component({
  selector: 'sd-project-detail',
  host: { class: 'tab-pane' },
  styleUrl: './project-detail.component.scss',
  templateUrl: './project-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, CodeBlockComponent],
})
export class ProjectDetailComponent {
  protected readonly i18n = inject(I18nService);

  /** Route param `:slug`, bound via withComponentInputBinding. */
  protected readonly slug = input.required<string>();

  protected readonly project = computed<ProjectScene>(() => {
    const scenes = this.i18n.content().projectScenes;

    return scenes.find((scene) => scene.slug === this.slug()) ?? scenes[0];
  });

  /** External resource links, in display order — built from the canonical `PROJECTS` meta. */
  protected readonly links = computed<ProjectLink[]>(() => {
    const meta = this.meta();
    const ui = this.i18n.content().projectsUi;

    if (!meta) {
      return [];
    }
    const ordered: ProjectLink[] = [{ label: ui.repo, href: meta.repo }];

    if (meta.nuget) {
      ordered.push({ label: ui.nuget, href: meta.nuget });
    }
    if (meta.docs) {
      ordered.push({ label: ui.docs, href: meta.docs });
    }
    if (meta.live) {
      ordered.push({ label: ui.live, href: meta.live });
    }

    return ordered;
  });

  /** On-site deep-dive article slug (internal routerLink), if the project has one. */
  protected readonly articleSlug = computed<string | null>(() => this.meta()?.article ?? null);

  /** Illustrative snippet for the "In practice" case-study section, if the project has one. */
  protected readonly codeSample = computed(() => this.meta()?.codeSample ?? null);

  /** Case-study preview screenshot for the visual projects, shown in place of the code sample. */
  protected readonly image = computed(() => this.meta()?.image ?? null);

  private readonly meta = computed<ProjectMeta | undefined>(
    () => PROJECTS[this.slug() as keyof typeof PROJECTS],
  );
}
