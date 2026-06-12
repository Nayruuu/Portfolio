import { test, expect } from '@playwright/test';

test('an article page exposes SEO metadata at runtime (title, OG, canonical, JSON-LD)', async ({
  page,
}) => {
  await page.goto('/fr/articles/etrangler-le-monolithe-dotnet');
  await page.waitForSelector('.article-detail__body');

  await expect(page).toHaveTitle(/super-dev\.app/);

  await expect(page.locator("meta[property='og:title']")).toHaveCount(1);
  await expect(page.locator("meta[property='og:type']")).toHaveAttribute('content', 'article');
  await expect(page.locator("link[rel='canonical']")).toHaveAttribute(
    'href',
    /\/fr\/articles\/etrangler-le-monolithe-dotnet$/,
  );
  await expect(page.locator("link[rel='alternate'][hreflang='en']")).toHaveCount(1);

  const jsonld = await page.locator('script#sd-jsonld').textContent();
  const data = JSON.parse(jsonld ?? '{}');

  expect(data['@type']).toBe('BlogPosting');
  expect(data.inLanguage).toBe('fr');
  expect(data.headline?.length ?? 0).toBeGreaterThan(0);
});
