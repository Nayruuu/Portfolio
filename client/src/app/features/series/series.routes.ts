import { Routes } from '@angular/router';

/** Internal routes for the series feature — list + detail, lazy. */
export const SERIES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./series.component').then((module) => module.SeriesComponent),
  },
  {
    path: ':slug',
    loadComponent: () =>
      import('./series-detail/series-detail.component').then(
        (module) => module.SeriesDetailComponent,
      ),
  },
];
