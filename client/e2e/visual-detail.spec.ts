import { test, expect } from '@playwright/test';

/**
 * Visual baseline for the DETAIL screens (article + series).
 * These change the most during the refactor (overlay → route): their snapshot
 * helps tell an INTENDED change from an accidental regression. Deliberate rebase
 * planned after the routing migration.
 */
test('visual — article-detail', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /articles/i }).click();
  await page.locator('a.vgrid-card').first().click();
  await expect(page.locator('article.article-detail')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('article-detail.png', { fullPage: true });
});

test('visual — series-detail', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /séries/i }).click();
  await page.locator('a.pcard').first().click();
  await expect(page.locator('article.series-detail')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveScreenshot('series-detail.png', { fullPage: true });
});
