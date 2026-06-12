import { test, expect } from '@playwright/test';

test('the channel search filters the articles grid; `/` focuses it', async ({ page }) => {
  await page.goto('/fr');

  // The `/` keys-hint shortcut focuses the search from anywhere.
  await page.locator('body').press('/');
  await expect(page.locator('.nav__search-input')).toBeFocused();

  // Typing routes to the articles list and filters the grid live.
  await page.locator('.nav__search-input').fill('angular');
  await expect(page).toHaveURL(/\/fr\/articles$/);
  await expect(page.locator('a.vgrid-card').first()).toBeVisible();

  // A query that matches nothing surfaces the empty state and zero cards.
  await page.locator('.nav__search-input').fill('zzzznotathing');
  await expect(page.locator('.vgrid-empty')).toBeVisible();
  await expect(page.locator('a.vgrid-card')).toHaveCount(0);
});
