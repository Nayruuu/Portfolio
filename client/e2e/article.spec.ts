import { test, expect } from '@playwright/test';

test('opens an article from the list and goes back', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /articles/i }).click();

  const firstCard = page.locator('a.vgrid-card').first();

  await expect(firstCard).toBeVisible();
  await firstCard.click();

  await expect(page.locator('article.article-detail')).toBeVisible();

  await page.getByRole('link', { name: /retour aux articles|back to articles/i }).click();
  await expect(page.locator('a.vgrid-card').first()).toBeVisible();
});
