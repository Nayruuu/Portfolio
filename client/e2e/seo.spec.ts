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
  // One hreflang per Lang + x-default; one og:locale:alternate per OTHER language.
  await expect(page.locator("link[rel='alternate'][hreflang]")).toHaveCount(5);
  await expect(page.locator("meta[property='og:locale:alternate']")).toHaveCount(3);

  const jsonld = await page.locator('script#sd-jsonld').textContent();
  const graph = JSON.parse(jsonld ?? '{}')['@graph'] ?? [];
  const posting = graph.find((entity: { '@type': string }) => entity['@type'] === 'BlogPosting');
  const breadcrumb = graph.find(
    (entity: { '@type': string }) => entity['@type'] === 'BreadcrumbList',
  );

  expect(posting?.inLanguage).toBe('fr');
  expect(posting?.headline?.length ?? 0).toBeGreaterThan(0);
  // The meta description is the human-written entry description, not "TAG · title · read time".
  expect(posting?.description).not.toMatch(/·\s*\d+\s*min$/);
  expect(breadcrumb?.itemListElement?.length).toBe(3);
});

test('the home exposes the WebSite + Person JSON-LD graph', async ({ page }) => {
  await page.goto('/fr');
  await page.waitForSelector('.channel');

  const jsonld = await page.locator('script#sd-jsonld').textContent();
  const graph = JSON.parse(jsonld ?? '{}')['@graph'] ?? [];
  const types = graph.map((entity: { '@type': string }) => entity['@type']);

  expect(types).toEqual(['WebSite', 'Person']);
});
