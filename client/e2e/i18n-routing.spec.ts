import { test, expect } from '@playwright/test';

test('the root redirects to a language in the URL', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/fr$/); // locale fr-FR → defaults to fr
});

test('the language toggle changes the URL and content', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav .prefs__lang-toggle').click(); // open the language dropdown
  await page.getByRole('menuitemradio', { name: 'EN' }).click();
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

test('a Spanish deep link renders Spanish UI, and the picker offers every language', async ({
  page,
}) => {
  await page.goto('/es');
  await expect(page).toHaveURL(/\/es$/);
  await expect(page.getByRole('tab', { name: 'Inicio' })).toBeVisible();
  // The dropdown toggle shows the current language; opening it lists all four.
  await expect(page.locator('.nav .prefs__lang-toggle')).toHaveText(/ES/);
  await page.locator('.nav .prefs__lang-toggle').click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(4);
});
