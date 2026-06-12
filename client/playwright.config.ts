import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright — E2E comportemental + régression visuelle.
 * Sert de filet de sécurité avant/après le refactor d'architecture.
 * Démarre automatiquement le serveur de dev (ng serve) sur :4200 — overridable via
 * `PW_PORT` quand :4200 est occupé par un autre projet (sinon `reuseExistingServer`
 * réutiliserait silencieusement la MAUVAISE app et tous les tests sonderaient le vide).
 */
const port = Number(process.env['PW_PORT'] ?? 4200);

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{-projectName}{ext}',
  // Visual screenshots flake under parallel contention (full-page captures racing on font load /
  // CPU); run serially for deterministic results — and it's faster for this small suite.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    // Locale déterministe : `/` redirige vers /fr (cohérent avec les baselines FR).
    locale: 'fr-FR',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The iOS specs drive the real WebKit engine (below); they are meaningless on Chromium.
      testIgnore: /(player|game)-ios\.spec\.ts/,
    },
    // Mobile only re-runs the visual specs (mobile baselines). Behavioural specs
    // drive nav controls that live in the closed drawer at phone widths, so they
    // stay desktop-only on chromium.
    { name: 'mobile', use: { ...devices['Pixel 5'] }, testMatch: /visual(-detail)?\.spec\.ts/ },
    // WebKit (the iOS Safari engine) — the mobile visual baselines run on Chromium
    // device emulation, so engine-specific WebKit rendering bugs are invisible there.
    // This narrow project guards the player against them. Needs `npx playwright install webkit`.
    { name: 'webkit', use: { ...devices['iPhone 13'] }, testMatch: /(player|game)-ios\.spec\.ts/ },
  ],
  webServer: {
    command: `npm start -- --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
