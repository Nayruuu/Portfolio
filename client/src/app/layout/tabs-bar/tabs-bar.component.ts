import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TAB_SEGMENTS } from '../../core/lib';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { IconName } from '../../shared/icon/icon-set';

/** Section icon for the mobile bottom bar, same order as `TAB_SEGMENTS`. */
const TAB_ICONS: readonly IconName[] = ['home', 'articles', 'series', 'about', 'layers', 'mail'];

@Component({
  selector: 'sd-tabs-bar',
  templateUrl: './tabs-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent],
})
export class TabsBarComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly content = computed(() => this.i18n.content());
  protected readonly icons = TAB_ICONS;

  /** Language-aware links: `/fr`, `/fr/articles`, … for the current language. */
  protected readonly links = computed(() => {
    const lang = this.i18n.lang();

    return TAB_SEGMENTS.map((segment) => (segment ? ['/', lang, segment] : ['/', lang]));
  });
}
