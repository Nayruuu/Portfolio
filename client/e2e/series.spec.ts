import { test, expect } from '@playwright/test';

test('opens a series from the list and goes back', async ({ page }) => {
  await page.goto('/fr/series');

  // The route-backed Articles | Séries toggle heads the list page.
  await expect(page.locator('.ctabs')).toBeVisible();

  const firstCard = page.locator('a.pcard').first();

  await expect(firstCard).toBeVisible();
  await firstCard.click();

  await expect(page.locator('article.series-detail')).toBeVisible();

  await page.getByRole('link', { name: /retour aux séries|back to series/i }).click();
  await expect(page.locator('a.pcard').first()).toBeVisible();
});

test('the content toggle switches between Articles and Séries', async ({ page }) => {
  await page.goto('/fr/articles');
  await expect(page.locator('.vgrid')).toBeVisible();

  await page
    .locator('.ctabs')
    .getByRole('link', { name: /séries/i })
    .click();
  await expect(page).toHaveURL(/\/fr\/series$/);
  await expect(page.locator('a.pcard').first()).toBeVisible();

  await page
    .locator('.ctabs')
    .getByRole('link', { name: /articles/i })
    .click();
  await expect(page).toHaveURL(/\/fr\/articles$/);
  await expect(page.locator('.vgrid')).toBeVisible();
});
