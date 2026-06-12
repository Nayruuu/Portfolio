import { test, expect } from '@playwright/test';

// Real tab labels (FR, default language); ARIA role `tab`.
const TABS = [/accueil/i, /articles/i, /séries/i, /propos/i, /stack/i, /contact/i];

test('navigates between tabs via the bar (UI clicks)', async ({ page }) => {
  await page.goto('/');
  for (const name of TABS) {
    const tab = page.getByRole('tab', { name });

    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  }
});
