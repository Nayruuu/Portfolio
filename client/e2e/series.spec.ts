import { test, expect } from '@playwright/test';

test('opens a series from the list and goes back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /séries/i }).click();

  const firstCard = page.locator('a.pcard').first();

  await expect(firstCard).toBeVisible();
  await firstCard.click();

  await expect(page.locator('article.series-detail')).toBeVisible();

  await page.getByRole('link', { name: /retour aux séries|back to series/i }).click();
  await expect(page.locator('a.pcard').first()).toBeVisible();
});
