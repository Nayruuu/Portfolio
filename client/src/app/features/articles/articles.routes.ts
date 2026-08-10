import { Routes } from '@angular/router';

/** Internal routes for the articles feature — list + detail, lazy. */
export const ARTICLES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./articles.component').then((module) => module.ArticlesComponent),
  },
  {
    path: ':slug',
    loadComponent: () =>
      import('./article-detail/article-detail.component').then(
        (module) => module.ArticleDetailComponent,
      ),
  },
];
