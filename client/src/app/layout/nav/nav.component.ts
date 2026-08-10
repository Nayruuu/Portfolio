import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { PaletteService } from '../../core/services/palette/palette.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { PrefsComponent } from '../prefs/prefs.component';

@Component({
  selector: 'sd-nav',
  styleUrl: './nav.component.scss',
  templateUrl: './nav.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, PrefsComponent],
})
export class NavComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly palette = inject(PaletteService);
  protected readonly content = computed(() => this.i18n.content());
}
