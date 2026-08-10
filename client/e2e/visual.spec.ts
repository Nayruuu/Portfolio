import { createHash } from 'node:crypto';
import { test, expect, Page } from '@playwright/test';

/**
 * Visual regression baseline — one snapshot per screen/tab.
 * Captured on the app BEFORE the refactor, replayed AFTER to catch any drift.
 * The `home` screen masks `.player` (continuous animation via setInterval);
 * `contact` masks the Altcha widget (its verify state is time-dependent).
 */
const SCREENS: { name: string; tab?: RegExp; path?: string; mask?: string }[] = [
  { name: 'home', mask: '.player' },
  { name: 'articles', tab: /articles/i },
  // Séries is no longer a top-level tab — it's reached via the content toggle; navigate straight to it.
  { name: 'series', path: '/fr/series' },
  { name: 'about', tab: /propos/i },
  { name: 'stack', tab: /stack/i },
  { name: 'contact', tab: /contact/i, mask: '.contact-form__altcha' },
];

async function stubAltcha(page: Page) {
  const salt = 'abcdef?expires=9999999999';
  const challenge = createHash('sha256')
    .update(salt + 4)
    .digest('hex');

  await page.route('**/api/altcha', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        algorithm: 'SHA-256',
        challenge,
        maxnumber: 20,
        salt,
        signature: 'x',
      }),
    }),
  );
}

async function gotoScreen(page: Page, screen: { tab?: RegExp; path?: string }) {
  await stubAltcha(page);
  if (screen.path) {
    await page.goto(screen.path);
  } else {
    await page.goto('/');
    if (screen.tab) {
      await page.getByRole('tab', { name: screen.tab }).click();
    }
  }
  await page.waitForLoadState('networkidle');
}

for (const s of SCREENS) {
  test(`visual — ${s.name}`, async ({ page }) => {
    await gotoScreen(page, s);
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      fullPage: true,
      mask: s.mask ? [page.locator(s.mask)] : [],
    });
  });
}
