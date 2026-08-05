import { test, expect } from '@playwright/test';

test('an article renders real Markdown prose with inline runs and no leaked syntax', async ({
  page,
}) => {
  await page.goto('/fr/articles/etrangler-le-monolithe-dotnet');

  const body = page.locator('.article-detail__body');

  await expect(body).toBeVisible();
  // Real prose from the parsed Markdown body (not the SPA shell).
  await expect(body).toContainText('anti-corruption');
  // Bold (`**…**`) was rendered to <strong>, not leaked as literal Markdown.
  await expect(body.locator('strong').first()).toBeVisible();
  await expect(body).not.toContainText('**');
});

test('inline code renders to a <code> element', async ({ page }) => {
  // This article uses inline `code` spans — proves the inline-run parser ran.
  await page.goto('/fr/articles/angular-ssg-azure-static-web-apps');

  const body = page.locator('.article-detail__body');

  await expect(body).toBeVisible();
  await expect(body.locator('code').first()).toBeVisible();
  // No leaked bold markdown in the PROSE. `**` is legitimate inside <code> here — the article
  // documents the `**` wildcard route — so strip code/pre before asserting.
  const prose = await body.evaluate((el) => {
    const clone = el.cloneNode(true) as HTMLElement;

    clone.querySelectorAll('code, pre, sd-code-block').forEach((node) => node.remove());

    return clone.textContent ?? '';
  });

  expect(prose).not.toContain('**');
});
