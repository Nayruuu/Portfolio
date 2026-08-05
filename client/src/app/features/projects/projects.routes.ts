import { Routes } from '@angular/router';

/** Internal routes for the projects feature — list + detail, lazy. */
export const PROJECTS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./projects.component').then((module) => module.ProjectsComponent),
  },
  {
    path: ':slug',
    loadComponent: () =>
      import('./project-detail/project-detail.component').then(
        (module) => module.ProjectDetailComponent,
      ),
  },
];
