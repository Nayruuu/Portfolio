import { InjectionToken } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * Base URL of the content API. Self-provided from the active build environment
 * (`environment.apiBaseUrl`), which `angular.json` `fileReplacements` swaps automatically for prod —
 * so nothing has to be wired in `app.config`. Override via a provider in tests when needed.
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => environment.apiBaseUrl,
});
