import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    // `anchorScrolling` makes `#fragment` links (the article TOC + heading permalinks) scroll to the
    // target, honouring the headings' `scroll-margin-top`; without it the router resets scroll to the top.
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ anchorScrolling: 'enabled' }),
    ),
    provideClientHydration(withEventReplay()),
    provideHttpClient(withFetch()),
  ],
};
