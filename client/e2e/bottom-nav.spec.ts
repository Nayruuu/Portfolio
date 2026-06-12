import { test, expect } from '@playwright/test';

/**
 * The section nav is a FIXED BOTTOM BAR on phones (the mobile baselines, on Pixel 5 emulation,
 * capture the look; this checks the behaviour). Runs under chromium at a 360px viewport.
 */
test.use({ viewport: { width: 360, height: 800 } });

test('the section nav is a fixed bottom bar on phones and routes on tap', async ({ page }) => {
  await page.goto('/fr');

  const tabs = page.locator('.tabs');
  const position = await tabs.evaluate((el) => getComputedStyle(el).position);

  expect(position).toBe('fixed');

  // The bar is anchored to the bottom of the viewport.
  const box = await tabs.boundingBox();
  const viewport = page.viewportSize()!;

  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeGreaterThan(viewport.height - 2);

  // Tapping a section routes and marks it selected.
  await page.getByRole('tab', { name: 'Articles' }).click();
  await expect(page).toHaveURL(/\/fr\/articles$/);
  await expect(page.getByRole('tab', { name: 'Articles' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
