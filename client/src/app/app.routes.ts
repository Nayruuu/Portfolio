import { inject } from '@angular/core';
import { ResolveFn, Routes } from '@angular/router';
import { I18nService } from './core/services/i18n/i18n.service';
import type { Lang } from './domain';

/**
 * Sets the language from the URL tree (`/fr` or `/en`) before the routed
 * component renders — so prerender/SSR and first paint get the right locale.
 * Replaces the old `:lang` param + canActivate: a parameter-FIRST parent route
 * breaks Angular's native prerenderer, so we use two explicit static trees.
 */
const langResolver: ResolveFn<Lang> = (route) => {
  const lang: Lang = route.routeConfig?.path === 'en' ? 'en' : 'fr';

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
 * Language is a URL prefix via two **explicit static** trees (`/fr`, `/en`) — not a
 * `:lang` param (which breaks native prerendering). Root and unknown paths redirect
 * to `/fr` with **static** strings, build-evaluable for SSG. Detail routes read `:id`
 * via `input()` (`withComponentInputBinding`).
 */
export const routes: Routes = [
  { path: 'fr', resolve: { lang: langResolver }, children: langChildren() },
  { path: 'en', resolve: { lang: langResolver }, children: langChildren() },
  { path: '', pathMatch: 'full', redirectTo: '/fr' },
  { path: '**', redirectTo: '/fr' },
];
