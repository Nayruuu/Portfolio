import { test, expect } from '@playwright/test';

test('the root redirects to a language in the URL', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/fr$/); // locale fr-FR → defaults to fr
});

test('the language toggle changes the URL and content', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav__lang').getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
});

test('a localized deep link renders the right language', async ({ page }) => {
  await page.goto('/en/articles');
  await expect(page).toHaveURL(/\/en\/articles$/);
  await expect(page.getByRole('tab', { name: 'Articles' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('a.vgrid-card').first()).toBeVisible();
});

test('the language is preserved while navigating (tab click)', async ({ page }) => {
  await page.goto('/en');
  await page.getByRole('tab', { name: /series/i }).click();
  await expect(page).toHaveURL(/\/en\/series$/);
});
