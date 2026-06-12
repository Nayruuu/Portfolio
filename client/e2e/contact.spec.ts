import { test, expect } from '@playwright/test';

test('the contact form is a mock (no network navigation)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /contact/i }).click();

  await page.locator('input[name="name"]').fill('Ada Lovelace');
  await page.locator('input[type="email"]').fill('ada@example.com');
  await page.locator('textarea[name="message"]').fill('Bonjour, parlons projet.');
  await page.locator('button[type="submit"]').click();

  // mock: submit does not navigate — we stay on /contact, and the live-region status confirms.
  await expect(page.locator('.contact-form')).toBeVisible();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.locator('.contact-form__status')).toContainText(/envoyé|sent/i);
});

test('the contact form blocks an invalid submit and shows inline errors', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /contact/i }).click();

  // Submit empty — validation must hold the form (no "sent" state) and surface field errors.
  await page.locator('button[type="submit"]').click();

  await expect(page.locator('.contact-form__error').first()).toBeVisible();
  await expect(page.locator('.contact-form__status')).toBeEmpty();
  await expect(page.locator('input[name="name"]')).toHaveAttribute('aria-invalid', 'true');
});
