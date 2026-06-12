import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    // withComponentInputBinding() binds route params (:id) directly to the
    // input() signals of the detail components.
    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(withEventReplay()),
  ],
};
