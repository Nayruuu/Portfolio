import { test, expect } from '@playwright/test';

test('the ⌘K palette searches and reaches the filtered articles list', async ({ page }) => {
  await page.goto('/fr');

  // `/` opens the palette from anywhere (the old nav-input shortcut now drives the palette).
  await page.locator('body').press('/');
  const panel = page.locator('.cmdk__panel');

  await expect(panel).toBeVisible();

  // Typing filters the results live.
  await page.locator('.cmdk__input').fill('angular');
  await expect(page.locator('.cmdk__row').first()).toBeVisible();

  // "See all results" seeds the grid filter and routes to the articles list.
  await page.getByRole('option', { name: /Voir tous les résultats/ }).click();
  await expect(page).toHaveURL(/\/fr\/articles$/);
  await expect(page.locator('a.vgrid-card').first()).toBeVisible();

  // Reopen; a query that matches nothing surfaces the empty state.
  await page.locator('body').press('/');
  await expect(panel).toBeVisible();
  await page.locator('.cmdk__input').fill('zzzznotathing');
  await expect(page.locator('.cmdk__empty')).toBeVisible();

  // Escape closes it.
  await page.locator('.cmdk__input').press('Escape');
  await expect(panel).toBeHidden();
});

test('the palette opens via Ctrl+K and via the nav search box', async ({ page }) => {
  await page.goto('/fr');
  const panel = page.locator('.cmdk__panel');

  // ⌘K / Ctrl+K toggles it.
  await page.keyboard.press('Control+k');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(panel).toBeHidden();

  // The desktop nav search box is now a trigger.
  await page.locator('.nav__search').click();
  await expect(panel).toBeVisible();

  // Arrow + Enter navigates to the selected page (the first row, "Accueil").
  await page.locator('.cmdk__input').fill('propos'); // → "À propos"
  await page.locator('.cmdk__input').press('Enter');
  await expect(page).toHaveURL(/\/fr\/about$/);
});
