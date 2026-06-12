import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { I18nService } from '../../core/services/i18n/i18n.service';
import { ThemeService } from '../../core/services/theme/theme.service';
import { IconComponent } from '../../shared/icon/icon.component';
import { LANGS, type Lang } from '../../domain';

/**
 * User preferences cluster — theme toggle + language picker. One component reused in two homes: the
 * desktop nav and the mobile floating dock (the nav is hidden on phones), so the logic lives once.
 */
@Component({
  selector: 'sd-prefs',
  styleUrl: './prefs.component.scss',
  templateUrl: './prefs.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
})
export class PrefsComponent {
  protected readonly i18n = inject(I18nService);
  protected readonly theme = inject(ThemeService);
  protected readonly langs = LANGS;
  protected readonly langOpen = signal(false);

  private readonly router = inject(Router);

  /** Navigate to the same path in the chosen language (swap segment 0); does not call `setLang`. */
  protected switchLang(lang: Lang): void {
    const segments = this.router.url.split(/[?#]/)[0].split('/').filter(Boolean);

    if (segments.length === 0) {
      segments.push(lang);
    } else {
      segments[0] = lang;
    }
    this.router.navigate(['/', ...segments]);
    this.langOpen.set(false);
  }

  protected toggleLang(): void {
    this.langOpen.update((open) => !open);
  }

  @HostListener('document:click', ['$event'])
  protected closeLangOnOutsideClick(event: Event): void {
    const target = event.target;

    if (this.langOpen() && target instanceof Element && !target.closest('.prefs__lang')) {
      this.langOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  protected closeLang(): void {
    this.langOpen.set(false);
  }
}
