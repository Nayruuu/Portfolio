import { createHash } from 'node:crypto';
import { test, expect, Page } from '@playwright/test';

/**
 * Visual regression baseline — one snapshot per screen/tab.
 * Captured on the app BEFORE the refactor, replayed AFTER to catch any drift.
 * The `home` screen masks `.player` (continuous animation via setInterval);
 * `contact` masks the Altcha widget (its verify state is time-dependent).
 */
const SCREENS: { name: string; tab?: RegExp; mask?: string }[] = [
  { name: 'home', mask: '.player' },
  { name: 'articles', tab: /articles/i },
  { name: 'series', tab: /séries/i },
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

async function gotoScreen(page: Page, tab?: RegExp) {
  await stubAltcha(page);
  await page.goto('/');
  if (tab) {
    await page.getByRole('tab', { name: tab }).click();
  }
  await page.waitForLoadState('networkidle');
}

for (const s of SCREENS) {
  test(`visual — ${s.name}`, async ({ page }) => {
    await gotoScreen(page, s.tab);
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      fullPage: true,
      mask: s.mask ? [page.locator(s.mask)] : [],
    });
  });
}
