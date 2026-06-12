import { test, expect } from '@playwright/test';

test('the theme toggle applies data-theme="dark"', async ({ page }) => {
  await page.goto('/');
  const html = page.locator('html');

  await expect(html).toHaveAttribute('data-theme', 'light'); // default
  // aria-label is now i18n'd (FR default = "Changer de thème"), no longer the hardcoded "toggle theme"
  await page.getByRole('button', { name: 'Changer de thème' }).click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
});

test('the language toggle switches the content FR → EN', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Accueil' })).toBeVisible(); // FR par défaut
  await page.locator('.nav__lang').getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible(); // contenu EN
  await expect(page.getByRole('tab', { name: 'Accueil' })).toHaveCount(0);
});
