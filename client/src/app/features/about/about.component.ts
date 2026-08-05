import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { SOCIAL_URLS } from '../../core/lib';
import type { AboutLink, ProjectScene } from '../../domain';

@Component({
  selector: 'sd-about',
  host: { class: 'tab-pane' },
  styleUrl: './about.component.scss',
  templateUrl: './about.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
})
export class AboutComponent {
  protected readonly i18n = inject(I18nService);

  /** The open-source projects with a dedicated page — links this profile to the person's works. */
  protected readonly projects = computed<ProjectScene[]>(() =>
    this.i18n.content().projectScenes.filter((project) => Boolean(project.slug)),
  );

  /**
   * Canonical href from the link's label: `mail` → mailto; a known profile resolves to its exact
   * `sameAs` URL (site.ts) so the visible link and the JSON-LD identity anchor never diverge (e.g.
   * LinkedIn's `www.`/percent-encoded form); anything else derives `https://` + label.
   */
  protected href(link: AboutLink): string {
    if (link.icon === 'mail') {
      return `mailto:${link.label}`;
    }
    const host = link.label.split('/')[0];

    return SOCIAL_URLS.find((url) => url.includes(host)) ?? `https://${link.label}`;
  }
}
