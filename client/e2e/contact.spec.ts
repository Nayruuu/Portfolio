import { test, expect } from '@playwright/test';

async function openContact(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: /contact/i }).click();
  await page.locator('input[name="name"]').fill('Ada Lovelace');
  await page.locator('input[type="email"]').fill('ada@example.com');
  await page.locator('textarea[name="message"]').fill('Bonjour, parlons projet.');
}

test('the contact form POSTs and confirms success without navigating', async ({ page }) => {
  let posted = false;

  await page.route('**/api/contact', (route) => {
    posted = route.request().method() === 'POST';

    return route.fulfill({ status: 202, contentType: 'application/json', body: '' });
  });

  await openContact(page);
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.locator('.contact-form__status')).toContainText(/envoyé|sent/i);
  expect(posted).toBe(true);
});

test('the contact form surfaces a delivery error and stays retryable', async ({ page }) => {
  await page.route('**/api/contact', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );

  await openContact(page);
  await page.locator('button[type="submit"]').click();

  await expect(page.locator('.contact-form__status')).toContainText(
    /échoué|failed|falló|fehlgeschlagen/i,
  );
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
});

test('the contact form blocks an invalid submit and shows inline errors', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /contact/i }).click();

  await page.locator('button[type="submit"]').click();

  await expect(page.locator('.contact-form__error').first()).toBeVisible();
  await expect(page.locator('.contact-form__status')).toBeEmpty();
  await expect(page.locator('input[name="name"]')).toHaveAttribute('aria-invalid', 'true');
});
