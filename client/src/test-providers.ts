import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

/**
 * Providers injected globally into the test environment.
 * - Zoneless change detection so `await fixture.whenStable()` works.
 * - Router (empty routes) so components using `routerLink` / `routerLinkActive`
 *   mount without per-test setup. Real navigation is covered by the Playwright
 *   E2E tests, not here.
 */
export default [provideZonelessChangeDetection(), provideRouter([])];
