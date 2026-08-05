import { createHash } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

// A tiny, solvable Altcha challenge so the widget's proof-of-work finishes instantly.
function stubAltchaChallenge(page: Page): Promise<void> {
  const salt = 'abcdef?expires=9999999999';
  const number = 4;
  const challenge = createHash('sha256')
    .update(salt + number)
    .digest('hex');

  return page.route('**/api/altcha', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        algorithm: 'SHA-256',
        challenge,
        maxnumber: 20,
        salt,
        signature: 'x',
      }),
    }),
  );
}

async function openContact(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('tab', { name: /contact/i }).click();
  await page.locator('input[name="name"]').fill('Ada Lovelace');
  await page.locator('input[type="email"]').fill('ada@example.com');
  await page.locator('textarea[name="message"]').fill('Bonjour, parlons projet.');
  // Wait for the widget's proof-of-work to finish before submitting.
  await expect(page.locator('altcha-widget input[name="altcha"]')).toHaveValue(/.+/);
}

test('the contact form solves altcha, POSTs the token, and confirms success', async ({ page }) => {
  await stubAltchaChallenge(page);
  let token: string | undefined;

  await page.route('**/api/contact', (route) => {
    token = (route.request().postDataJSON() as { altcha?: string }).altcha;

    return route.fulfill({ status: 202, contentType: 'application/json', body: '' });
  });

  await openContact(page);
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.locator('.contact-form__success-title')).toContainText(/envoyé|sent/i);
  expect(token).toBeTruthy();
});

test('the contact form surfaces a delivery error and stays retryable', async ({ page }) => {
  await stubAltchaChallenge(page);
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
  await stubAltchaChallenge(page);
  await page.goto('/');
  await page.getByRole('tab', { name: /contact/i }).click();

  await page.locator('button[type="submit"]').click();

  await expect(page.locator('.contact-form__error').first()).toBeVisible();
  await expect(page.locator('.contact-form__status')).toBeEmpty();
  await expect(page.locator('input[name="name"]')).toHaveAttribute('aria-invalid', 'true');
});
