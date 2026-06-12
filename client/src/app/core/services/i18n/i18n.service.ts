import { Injectable, Signal, inject } from '@angular/core';
import { Content, Lang } from '../../../domain';
import { ContentStore } from '../content/content.store';

/**
 * I18N facade over `ContentStore` (NgRx SignalStore). A stable, lightweight surface
 * (`lang` / `content` / `loading` / `setLang`) so consumers and the router never depend on the
 * store shape. `content` is always present (the store seeds it synchronously).
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  public readonly lang: Signal<Lang>;
  public readonly content: Signal<Content>;
  public readonly loading: Signal<boolean>;

  private readonly store = inject(ContentStore);

  constructor() {
    this.lang = this.store.lang;
    this.content = this.store.content;
    this.loading = this.store.loading;
  }

  public setLang(lang: Lang): void {
    this.store.setLang(lang);
  }
}
