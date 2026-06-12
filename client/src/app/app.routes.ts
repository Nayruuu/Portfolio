import { inject } from '@angular/core';
import { ResolveFn, Routes } from '@angular/router';
import { I18nService } from './core/services/i18n/i18n.service';
import { DEFAULT_LANG, isLang, LANGS, type Lang } from './domain';

/**
 * Sets the language from the URL tree (`/fr`, `/en`, …) before the routed
 * component renders — so prerender/SSR and first paint get the right locale.
 * Replaces the old `:lang` param + canActivate: a parameter-FIRST parent route
 * breaks Angular's native prerenderer, so we use one explicit static tree per language.
 */
const langResolver: ResolveFn<Lang> = (route) => {
  const path = route.routeConfig?.path;
  const lang: Lang = isLang(path) ? path : DEFAULT_LANG;

  inject(I18nService).setLang(lang);

  return lang;
};

/** Lazy children shared by both language trees. */
const langChildren = (): Routes => [
  {
    path: '',
    loadComponent: () =>
      import('./features/home/home.component').then((module) => module.HomeComponent),
  },
  {
    path: 'articles',
    loadChildren: () =>
      import('./features/articles/articles.routes').then((module) => module.ARTICLES_ROUTES),
  },
  {
    path: 'series',
    loadChildren: () =>
      import('./features/series/series.routes').then((module) => module.SERIES_ROUTES),
  },
  {
    path: 'about',
    loadComponent: () =>
      import('./features/about/about.component').then((module) => module.AboutComponent),
  },
  {
    path: 'stack',
    loadComponent: () =>
      import('./features/stack/stack.component').then((module) => module.StackComponent),
  },
  {
    path: 'contact',
    loadComponent: () =>
      import('./features/contact/contact.component').then((module) => module.ContactComponent),
  },
];

/**
 * Language is a URL prefix via one **explicit static** tree per `Lang` (`/fr`, `/en`, …) — never a
 * `:lang` param (which breaks native prerendering). The trees are built from `LANGS`, so adding a
 * language is a one-line change there. Root and unknown paths redirect to the default language with a
 * **static** string (the template resolves to a literal at module load, build-evaluable for SSG).
 * Detail routes read `:slug` via `input()` (`withComponentInputBinding`).
 */
export const routes: Routes = [
  ...LANGS.map((lang) => ({
    path: lang,
    resolve: { lang: langResolver },
    children: langChildren(),
  })),
  {
    path: 'bsp',
    loadComponent: () =>
      import('./features/bsp-demo/bsp-demo.component').then((module) => module.BspDemoComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: `/${DEFAULT_LANG}` },
  { path: '**', redirectTo: `/${DEFAULT_LANG}` },
];
