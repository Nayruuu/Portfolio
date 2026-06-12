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
  await expect(body).not.toContainText('**');
});
