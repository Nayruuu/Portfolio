import { DOCUMENT, effect, inject } from '@angular/core';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { Content, DEFAULT_LANG, isLang, Lang } from '../../../domain';
import { STORAGE_KEYS } from '../../lib';
import { ContentApiService } from '../../api/content-api.service';

/**
 * Initial language: the persisted preference (any supported `Lang`), else the default. localStorage
 * only on purpose — no `navigator.language` sniffing, so SSR/prerender and tests default
 * deterministically to the default language.
 */
function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.LANG);

    return stored !== null && isLang(stored) ? stored : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}

interface ContentState {
  lang: Lang;
  content: Content;
  loading: boolean;
}

/**
 * Content store (NgRx SignalStore) — source of truth for the active language and the resolved
 * content tree, following **stale-while-revalidate**: `peek()` seeds the content synchronously
 * (instant first paint + SSG), then the async `getContent()` revalidates it (a visible `loading`
 * on language switch). `ContentApiService` is the only seam to swap the mock for a real .NET API.
 */
export const ContentStore = signalStore(
  { providedIn: 'root' },
  withState<ContentState>(() => {
    const lang = readInitialLang();

    return { lang, content: inject(ContentApiService).peek(lang), loading: false };
  }),
  withMethods((store) => {
    const api = inject(ContentApiService);

    /** Fetch the content for `lang`; last-wins (a newer language switch cancels this result). */
    const reload = async (lang: Lang): Promise<void> => {
      patchState(store, { loading: true });
      const content = await api.getContent(lang);

      if (store.lang() === lang) {
        patchState(store, { content, loading: false });
      }
    };

    return {
      reload,
      setLang(lang: Lang): void {
        // Swap content **synchronously** via `peek` so prerender/SSR and first paint get the right
        // locale immediately (the route resolver runs before the snapshot), then revalidate async.
        patchState(store, { lang, content: api.peek(lang) });
        void reload(lang);
      },
    };
  }),
  withHooks({
    onInit(store) {
      const doc = inject(DOCUMENT);

      // Revalidate the seeded content once at startup.
      void store.reload(store.lang());

      // Persist the language and reflect it on <html lang="…"> reactively.
      effect(() => {
        const lang = store.lang();

        try {
          localStorage.setItem(STORAGE_KEYS.LANG, lang);
        } catch {
          /* localStorage indisponible */
        }
        doc.documentElement.setAttribute('lang', lang);
      });
    },
  }),
);
