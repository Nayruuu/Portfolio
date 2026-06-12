import { test, expect, Page } from '@playwright/test';

/**
 * Visual regression baseline — one snapshot per screen/tab.
 * Captured on the app BEFORE the refactor, replayed AFTER to catch any drift.
 * The `home` screen masks `.player` (continuous animation via setInterval).
 */
const SCREENS: { name: string; tab?: RegExp; mask?: string }[] = [
  { name: 'home', mask: '.player' },
  { name: 'articles', tab: /articles/i },
  { name: 'series', tab: /séries/i },
  { name: 'about', tab: /propos/i },
  { name: 'stack', tab: /stack/i },
  { name: 'contact', tab: /contact/i },
];

async function gotoScreen(page: Page, tab?: RegExp) {
  await page.goto('/');
  if (tab) {await page.getByRole('tab', { name: tab }).click();}
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
